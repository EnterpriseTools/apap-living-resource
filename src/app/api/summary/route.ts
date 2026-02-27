import { NextRequest, NextResponse } from 'next/server';
import type { SummaryBundle } from '@/lib/summaryBundle';
import { fetchWithRetry, RATE_LIMIT_MESSAGE, TIMEOUT_MESSAGE } from '@/lib/openaiRetry';

/** Allow route to run up to 60s so summary generation can complete (Vercel Pro default; Free tier is 10s). */
export const maxDuration = 60;

/**
 * OpenAI API Authentication
 * 
 * This route follows OpenAI's official authentication guidelines:
 * - API keys are provided via HTTP Bearer authentication
 * - API keys are loaded from server-side environment variables (never exposed to client)
 * - Organization and Project headers can be used for multi-org/project accounts
 * 
 * Reference: https://platform.openai.com/docs/api-reference/authentication
 * 
 * Security: API keys are secrets and should never be shared or exposed in client-side code.
 */

const SYSTEM_PROMPT = `You are a data analyst writing executive summaries for VR APAP (Adoption Percentage) metrics in a CUSH (Clear, Useful, Strategic, Honest) narrative style.

CRITICAL RULES:
1. You MUST ONLY reference numbers and values that are explicitly provided in the metrics bundle. NEVER invent, estimate, or infer numbers that are not in the bundle.
2. If a number is not in the bundle, say "data not available" or omit that detail.
3. You MUST include this disclaimer: "Labels are based on Simulator Training only."
4. Write in a CUSH style: Clear, direct, actionable, and focused on what moved and why it matters.
5. Use specific numbers from the bundle to support your points.
6. Structure the summary with these key sections:
   - APAP Month-over-Month: How APAP changed, what drove the change
   - Biggest Drivers: New agencies who are adopting (from drivers.new_adopting)
   - Biggest Shakers: Newly unadopting agencies (from shakers.newly_churned and shakers.newly_unadopting)
   - Trends: Cohort performance, patterns across time since purchase, agency size, CEW type
   - Path to Goals: Analysis of gap to 42% (high confidence) and 46.2% (hard climb) goals, what it would take to reach them
7. Be specific about agency names, officer counts, and what changed month-over-month.
8. Focus on actionable insights: who to contact, what cohorts are moving, what's working/not working.`;

function buildUserPrompt(bundle: SummaryBundle): string {
  return `Write a CUSH-style executive summary based on the following VR APAP metrics bundle.

Metrics Bundle:
${JSON.stringify(bundle)}

Requirements:
- Write in CUSH narrative style: Clear, Useful, Strategic, Honest
- Focus on these key areas:
  1. APAP Month-over-Month: Analyze how APAP changed (bundle.apap.current vs bundle.apap.previous_month, bundle.apap.mom_change). What drove the change?
  2. Biggest Drivers: Highlight new adopting agencies (bundle.drivers.new_adopting). Who are they? What cohorts? What's their impact?
  3. Biggest Shakers: Identify newly churned (bundle.shakers.newly_churned) and newly unadopting agencies (bundle.shakers.newly_unadopting). Who fell off? Why might this have happened?
  4. Trends: Analyze cohort highlights (bundle.cohort_highlights) - which cohorts are performing best/worst? What patterns emerge?
  5. Path to Goals: Current APAP is ${bundle.apap.current.toFixed(1)}%. High confidence goal is 42% (gap: ${bundle.apap.gap_to_high_confidence.toFixed(1)}pp). Hard climb goal is 46.2% (gap: ${bundle.apap.gap_to_hard_climb.toFixed(1)}pp). What would it take to reach these goals? How many agencies need to adopt? What's the path forward?
- Use ONLY the numbers provided in the bundle
- Include the required disclaimer: "Labels are based on Simulator Training only."
- Be specific: mention agency names, officer counts, cohorts when relevant
- Keep it concise but informative (aim for 600-1000 words)
- Write in markdown format with clear section headers`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { bundle } = body;

    if (!bundle) {
      return NextResponse.json(
        { error: 'Missing bundle in request body' },
        { status: 400 }
      );
    }

    // Validate bundle structure (basic check)
    if (!bundle.as_of_month || !bundle.kpi || !bundle.cohort_highlights) {
      return NextResponse.json(
        { error: 'Invalid bundle structure' },
        { status: 400 }
      );
    }

    // Check for OpenAI API key (must be from your enterprise account)
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured. Please set OPENAI_API_KEY environment variable with your enterprise account key.' },
        { status: 500 }
      );
    }

    // Support enterprise endpoints (if OPENAI_API_BASE_URL is set, use it; otherwise use standard endpoint)
    const apiBaseUrl = process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1';
    const apiEndpoint = `${apiBaseUrl}/chat/completions`;

    // Build headers following OpenAI's official authentication method
    // API keys should be provided via HTTP Bearer authentication
    // Reference: https://platform.openai.com/docs/api-reference/authentication
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

    // Call OpenAI API (with retry on 429/503)
    const userPrompt = buildUserPrompt(bundle as SummaryBundle);

    const response = await fetchWithRetry(apiEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini', // Can be overridden via env var
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 2000,
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

      const isInsufficientQuota =
        parsed?.error?.code === 'insufficient_quota' || parsed?.error?.type === 'insufficient_quota';
      const message = isInsufficientQuota
        ? 'OpenAI quota exceeded for the configured key/project. Check project budget/billing or use a key with available quota.'
        : response.status === 429
          ? RATE_LIMIT_MESSAGE
          : `OpenAI API error: ${response.statusText}`;
      const body: { error: string; details?: Record<string, unknown> } = { error: message };
      if (process.env.NODE_ENV !== 'production') body.details = details;
      return NextResponse.json(body, { status: response.status });
    }

    const data = await response.json();
    const markdown = data.choices[0]?.message?.content || '';

    if (!markdown) {
      return NextResponse.json(
        { error: 'No content returned from OpenAI' },
        { status: 500 }
      );
    }

    return NextResponse.json({ markdown });
  } catch (error) {
    console.error('Error generating summary:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate summary';
    const status = message === TIMEOUT_MESSAGE ? 504 : 500;
    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
