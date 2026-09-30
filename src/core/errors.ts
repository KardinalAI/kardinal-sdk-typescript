/**
 * Exception hierarchy, organized by family. Every public error carries
 * `code`, `status`, `requestId`, `retryable`, `warnings`, `errors` and
 * `details`. `retryable` is computed here —
 * the API doesn't provide it. An unrecognized `code` falls back to the
 * family deduced from the HTTP status rather than disappearing, since
 * `Error.code` in openapi.yaml documents that new codes may be added in a
 * future non-breaking release.
 *
 * `requestId` is `null` more often than not: openapi.yaml documents no
 * request-id header or field anywhere, so this is best-effort — populated
 * only when the server happens to send an `X-Request-Id` response header.
 *
 * `warnings` is `EnvelopedErrors.warnings`: on a rejected payload,
 * amendments the server applied before the rejecting error was found.
 *
 * `errors` is every `Error` object of the response envelope, on every
 * family, and `details` the `properties.details` of the error `code` came
 * from: the only way to tell apart errors sharing a code — every limit
 * (plan size, daily quota, exhausted credits) is `403 NOT_ALLOWED`, and two
 * `404 NOT_FOUND` differ only by it ("Plan not found" vs. "Solution version
 * not found."). Both are empty for client-side errors and for a 429, which
 * carries no envelope.
 */

/** One `Error` object of the response envelope. */
export interface ApiErrorEntry {
  code: string;
  message: string;
  properties?: { details?: string; path?: string; [key: string]: unknown };
}

export interface KardinalErrorOptions {
  code: string;
  status: number;
  requestId: string | null;
  retryable: boolean;
  errors?: ApiErrorEntry[];
  warnings?: ApiErrorEntry[];
}

export class KardinalError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly retryable: boolean;
  readonly errors: ApiErrorEntry[];
  readonly warnings: ApiErrorEntry[];

  constructor(message: string, opts: KardinalErrorOptions) {
    super(message);
    this.name = new.target.name;
    this.code = opts.code;
    this.status = opts.status;
    this.requestId = opts.requestId;
    this.retryable = opts.retryable;
    this.errors = opts.errors ?? [];
    this.warnings = opts.warnings ?? [];
  }

  /** `properties.details` of the error `code` came from (the first one,
   * unless a 403 put the reason for the 403 further down). */
  get details(): string | null {
    if (this.errors.length === 0) return null;
    const source = this.errors.find((e) => e.code === this.code) ?? this.errors[0];
    return source.properties?.details ?? null;
  }
}

/** `NOT_AUTHENTICATED` (401): the API key is missing, malformed, or
 * expired, or was issued for another environment. */
export class KardinalAuthError extends KardinalError {}

/**
 * Any 403 (`NOT_ALLOWED`): a limit of the agency was hit — a plan-size
 * limit (resources, orders, stops), the daily/monthly optimization quota,
 * or exhausted credits. For a builder account a 403 never means a
 * permission refusal (see `NOT_ALLOWED` in openapi.yaml).
 *
 * `.details` says which limit. For a plan-size limit, `.errors` also has an
 * `INVALID_VALUE` entry, placed first by the API, whose `properties.path`
 * and `properties.details` name the field and the allowed value.
 * Classified on the 403 status rather than on a code, so finer codes the
 * API may add under 403 land here too.
 */
export class KardinalLimitError extends KardinalError {}

/**
 * One of the 7 business codes returned under 400. A single 400 can report
 * several invalid fields at once: `.errors` has them all, not just the
 * first.
 */
export class KardinalValidationError extends KardinalError {}

/** `NOT_FOUND` (404). Raised on every 404, including reads — no "get or null". */
export class KardinalNotFoundError extends KardinalError {}

/**
 * 429: a temporary overload, not a quota — retry after a pause, with an
 * increasing delay. The response has an empty body (no envelope to parse a
 * business `code`/`message` from): `.code` is set to the synthetic value
 * `"RATE_LIMITED"`.
 */
export class KardinalRateLimitError extends KardinalError {}

/** `INTERNAL_SERVER_ERROR`, or any other 5xx. */
export class KardinalServerError extends KardinalError {}

/**
 * The hard `timeout` guard on `solutions.wait()` elapsed before the plan
 * reached a terminal state. Client-side only — no HTTP response backs it.
 */
export class KardinalTimeoutError extends KardinalError {}

/**
 * `solutions.wait()` can't return a solution for the plan version it was
 * waiting on. Client-side only, like `KardinalTimeoutError`. `.code`:
 *
 * - `OPTIMIZATION_STALLED`: still optimizing well past its
 *   `maxOptimizationDuration` — the engine most likely crashed, and nothing
 *   will ever move the state again.
 * - `NO_SOLUTION`: the plan ended (typically stopped before the engine
 *   started) without a solution for this version.
 * - `PLAN_SUPERSEDED`: a newer version of the plan was pushed meanwhile.
 */
export class KardinalOptimizationError extends KardinalError {
  readonly planId: string;
  readonly planVersion: number | null;
  readonly state: string;

  constructor(
    message: string,
    opts: { code: string; planId: string; planVersion: number | null; state: string }
  ) {
    super(message, { code: opts.code, status: 0, requestId: null, retryable: false });
    this.planId = opts.planId;
    this.planVersion = opts.planVersion;
    this.state = opts.state;
  }
}

/**
 * A network-level failure (DNS, connection refused, fetch aborted, ...)
 * that never got an HTTP response at all, after retries were exhausted.
 * `retryable` unless the request was a POST that may have reached the
 * server: a connection that never opened is safe to retry, a response lost
 * after sending a POST isn't (the plan may exist).
 * Client-side only, same as KardinalTimeoutError — without this, a
 * `catch (e) { if (e instanceof KardinalError) ... }` written to catch
 * "anything that can go wrong talking to the API" would miss what's
 * arguably the most common real failure mode.
 */
export class KardinalConnectionError extends KardinalError {}

const VALIDATION_CODES = new Set([
  "INVALID_INPUT",
  "ID_NOT_UNIQUE",
  "KEYS_NOT_UNIQUE",
  "INVALID_ID_REFERENCE",
  "INVALID_VALUE",
  "PRECONDITION_FAILED",
  "NOT_IMPLEMENTED",
]);
const AUTH_CODES = new Set(["NOT_AUTHENTICATED"]);

type ErrorClass = new (message: string, opts: KardinalErrorOptions) => KardinalError;

function familyForStatus(status: number): ErrorClass {
  if (status === 401) return KardinalAuthError;
  if (status === 404) return KardinalNotFoundError;
  if (status === 429) return KardinalRateLimitError;
  if (status >= 500) return KardinalServerError;
  return KardinalValidationError;
}

function synthesizeCode(status: number): string {
  const known: Record<number, string> = {
    401: "NOT_AUTHENTICATED",
    403: "NOT_ALLOWED",
    404: "NOT_FOUND",
    429: "RATE_LIMITED",
  };
  if (known[status]) return known[status];
  return status >= 500 ? "INTERNAL_SERVER_ERROR" : "INVALID_INPUT";
}

/**
 * Build the right exception for a failed HTTP response. `errors` is the
 * parsed `EnvelopedErrors.errors` list (empty for a 429, which carries no
 * envelope at all), `warnings` is `EnvelopedErrors.warnings`.
 *
 * `retryable` means "retrying is safe and may succeed": a 429 always (the
 * cluster refuses it before any processing), a 5xx except on POST, where
 * the plan may have been created before the server failed and a retry
 * could create it twice.
 */
export function fromResponse(opts: {
  status: number;
  requestId: string | null;
  errors: ApiErrorEntry[];
  warnings?: ApiErrorEntry[];
  method?: string;
}): KardinalError {
  const { status, requestId, errors, warnings, method = "GET" } = opts;
  // A plan-size limit comes back as a 403 whose first error is the
  // INVALID_VALUE naming the field, followed by the error that explains the
  // 403 itself: for a 403, `code` comes from the first error that isn't a
  // validation code.
  let primary: ApiErrorEntry | undefined = errors[0];
  if (status === 403) primary = errors.find((e) => !VALIDATION_CODES.has(e.code)) ?? primary;
  const code = primary?.code ?? synthesizeCode(status);
  const message = primary?.message ?? `HTTP ${status}`;
  const retryable = status === 429 || (status >= 500 && method.toUpperCase() !== "POST");

  let Family: ErrorClass;
  if (status === 403) Family = KardinalLimitError;
  else if (AUTH_CODES.has(code)) Family = KardinalAuthError;
  else if (VALIDATION_CODES.has(code)) Family = KardinalValidationError;
  else if (code === "NOT_FOUND") Family = KardinalNotFoundError;
  else if (code === "INTERNAL_SERVER_ERROR") Family = KardinalServerError;
  else Family = familyForStatus(status);

  return new Family(message, { code, status, requestId, retryable, errors, warnings });
}
