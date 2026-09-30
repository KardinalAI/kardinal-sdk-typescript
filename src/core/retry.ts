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

/** Exponential backoff. `attempt` is 1-indexed (first retry is attempt 1). */
export function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 8000);
}

export function sleep(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
}
