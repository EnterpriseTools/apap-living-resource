import { NextRequest, NextResponse } from 'next/server';
import type { SummaryBundle } from '@/lib/summaryBundle';
import { fetchWithRetry, RATE_LIMIT_MESSAGE, TIMEOUT_MESSAGE } from '@/lib/openaiRetry';

/** Allow route to run up to 60s for chat completion. */
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are a helpful assistant answering questions about VR APAP (Adoption Percentage) metrics summaries.

CRITICAL RULES:
1. You MUST ONLY reference numbers and values that are explicitly provided in the metrics bundle. NEVER invent, estimate, or infer numbers that are not in the bundle.
2. If a number is not in the bundle, say "data not available" or "that information is not in the current metrics bundle."
3. You MUST include this disclaimer when relevant: "Labels are based on Simulator Training only."
4. Answer questions clearly and concisely, using specific numbers from the bundle.
5. If asked about something not in the bundle, politely explain what data is available instead.`;

function buildChatPrompt(bundle: SummaryBundle, messages: Array<{ role: string; content: string }>): string {
  const conversationHistory = messages
    .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
    .join('\n\n');

  return `You are answering questions about a VR APAP metrics summary. Here is the metrics bundle:

${JSON.stringify(bundle)}

Conversation history:
${conversationHistory}

Answer the user's question using ONLY the data from the metrics bundle above. Be specific and reference actual numbers.`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { bundle, messages } = body;

    if (!bundle) {
      return NextResponse.json(
        { error: 'Missing bundle in request body' },
        { status: 400 }
      );
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'Missing messages in request body' },
        { status: 400 }
      );
    }

    // Check for OpenAI API key
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured. Please set OPENAI_API_KEY environment variable with your enterprise account key.' },
        { status: 500 }
      );
    }

    // Support enterprise endpoints
    const apiBaseUrl = process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1';
    const apiEndpoint = `${apiBaseUrl}/chat/completions`;

    // Build headers following OpenAI's official authentication method
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };

    // Optional org/project scoping for enterprise accounts.
    // If using a project-scoped key (sk-proj-...), avoid overriding routing with headers.
    const isProjectScopedKey = apiKey.startsWith('sk-proj-');
    if (!isProjectScopedKey && process.env.OPENAI_ORGANIZATION_ID) {
      headers['OpenAI-Organization'] = process.env.OPENAI_ORGANIZATION_ID;
    }
    if (!isProjectScopedKey && process.env.OPENAI_PROJECT_ID) {
      headers['OpenAI-Project'] = process.env.OPENAI_PROJECT_ID;
    }

    // Get the last user message
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    if (!lastUserMessage) {
      return NextResponse.json(
        { error: 'No user message found' },
        { status: 400 }
      );
    }

    // Build the chat prompt
    const userPrompt = buildChatPrompt(bundle as SummaryBundle, messages);

    const response = await fetchWithRetry(apiEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const rawText = await response.text();
      console.error('OpenAI API error:', rawText);

      let parsed: { error?: { message?: string; code?: string; type?: string } } | null = null;
      try {
        parsed = JSON.parse(rawText) as { error?: { message?: string; code?: string; type?: string } };
      } catch {
        // not JSON
      }
      const retryAfter = response.headers.get('Retry-After') ?? undefined;
      const requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? null;
      const details: Record<string, unknown> = {
        status: response.status,
        statusText: response.statusText,
        retryAfter,
        requestId,
        openaiError: parsed?.error ?? null,
        rawTextSnippet: rawText.slice(0, 500),
      };

      const message =
        response.status === 429 ? RATE_LIMIT_MESSAGE : `OpenAI API error: ${response.statusText}`;
      const body: { error: string; details?: Record<string, unknown> } = { error: message };
      if (process.env.NODE_ENV !== 'production') body.details = details;
      return NextResponse.json(body, { status: response.status });
    }

    const data = await response.json();
    const responseText = data.choices[0]?.message?.content || '';

    if (!responseText) {
      return NextResponse.json(
        { error: 'No content returned from OpenAI' },
        { status: 500 }
      );
    }

    return NextResponse.json({ response: responseText });
  } catch (error) {
    console.error('Error in chat:', error);
    const message = error instanceof Error ? error.message : 'Failed to process chat message';
    const status = message === TIMEOUT_MESSAGE ? 504 : 500;
    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
