/**
 * Fetch with retries for OpenAI API rate limits (429) and server errors (503).
 * Uses exponential backoff: 2s, 4s, 8s. Max 3 attempts.
 * Optional timeout (ms) aborts the request so we return a clear error instead of platform killing the route.
 */

const RETRY_STATUSES = [429, 503];
const MAX_ATTEMPTS = 3;
const INITIAL_DELAY_MS = 2000;

/** Default timeout for OpenAI calls (ms). Kept under route maxDuration so we return a clean timeout error. */
export const OPENAI_REQUEST_TIMEOUT_MS = 55_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  timeoutMs: number = OPENAI_REQUEST_TIMEOUT_MS
): Promise<Response> {
  let lastResponse: Response | null = null;
  let delay = INITIAL_DELAY_MS;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const fetchOptions: RequestInit = {
      ...options,
      signal: controller.signal,
    };

    try {
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);
      lastResponse = response;

      if (response.ok || !RETRY_STATUSES.includes(response.status)) {
        return response;
      }

      if (attempt < MAX_ATTEMPTS) {
        const retryAfter = response.headers.get('Retry-After');
        const waitMs = retryAfter
          ? Math.min(Number(retryAfter) * 1000, 30_000)
          : delay;
        console.warn(
          `OpenAI API ${response.status}, attempt ${attempt}/${MAX_ATTEMPTS}, retrying in ${waitMs}ms`
        );
        await sleep(waitMs);
        delay *= 2;
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(TIMEOUT_MESSAGE);
      }
      throw err;
    }
  }

  return lastResponse!;
}

/** User-facing message when rate limit (429) is hit after retries. */
export const RATE_LIMIT_MESSAGE =
  'Too many requests. Please wait a minute and try again.';

/** User-facing message when the request times out. */
export const TIMEOUT_MESSAGE =
  'Request timed out. Summary generation can take 30–60 seconds. Try again.';
