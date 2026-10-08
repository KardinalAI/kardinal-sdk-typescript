/**
 * Retry policy. openapi.yaml defines no `Idempotency-Key`, so retrying
 * `POST /plans` (`submit`) after a network error or a 5xx could
 * double-create a plan. Only GET/PUT/DELETE are retried automatically;
 * POST is not.
 */

const RETRYABLE_METHODS = new Set(["GET", "PUT", "DELETE"]);
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export function isRetryable(
  method: string,
  opts: { status: number | null; networkError: boolean }
): boolean {
  if (!RETRYABLE_METHODS.has(method.toUpperCase())) return false;
  if (opts.networkError) return true;
  return opts.status !== null && RETRYABLE_STATUSES.has(opts.status);
}

const BACKOFF_CAP_MS = 8000;
const RETRY_AFTER_CAP_MS = 60_000;

/** `Retry-After` as milliseconds, or `null` when the header is absent or
 * unusable. Both forms the HTTP spec allows are accepted: a number of
 * seconds, and an HTTP date. A date already in the past gives 0 — the
 * server is saying "now" — and anything beyond a minute is capped rather
 * than trusted, so a bad header can't park a caller indefinitely. */
export function retryAfterMs(header: string | null): number | null {
  if (header === null) return null;
  const value = header.trim();
  if (value === "") return null;

  if (/^\d+$/.test(value)) {
    return Math.min(Number(value) * 1000, RETRY_AFTER_CAP_MS);
  }
  // An HTTP-date always carries a day or month name, so requiring a letter
  // keeps `Date.parse` from reading something like "-5" as a year and
  // reporting a date in the past, i.e. "retry now".
  if (!/[A-Za-z]/.test(value)) return null;
  const when = Date.parse(value);
  if (Number.isNaN(when)) return null;
  return Math.min(Math.max(0, when - Date.now()), RETRY_AFTER_CAP_MS);
}

/** Exponential backoff. `attempt` is 1-indexed (first retry is attempt 1).
 *
 * Jittered: without it, every client throttled by the same 429 retries at
 * the same moment and rebuilds the burst that caused it. The delay keeps
 * its floor and spreads over the window above it. */
export function backoffMs(attempt: number): number {
  const ceiling = Math.min(500 * 2 ** (attempt - 1), BACKOFF_CAP_MS);
  return ceiling / 2 + Math.random() * (ceiling / 2);
}

/** How long to wait before the next attempt.
 *
 * The server's own `Retry-After` wins when it sent one: it knows when the
 * limit lifts, and backing off on a schedule of our own against a rate
 * limiter is how a client gets throttled for longer than it had to be. */
export function retryDelayMs(attempt: number, retryAfter: string | null = null): number {
  return retryAfterMs(retryAfter) ?? backoffMs(attempt);
}

export function sleep(attempt: number, retryAfter: string | null = null): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt, retryAfter)));
}
