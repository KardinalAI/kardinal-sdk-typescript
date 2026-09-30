/**
 * Exception hierarchy, organized by family. Every public error carries
 * `code`, `status`, `requestId`, `retryable`. `retryable` is computed here —
 * the API doesn't provide it. An unrecognized `code` falls back to the
 * family deduced from the HTTP status rather than disappearing, since
 * `Error.code` in openapi.yaml documents that new codes may be added in a
 * future non-breaking release.
 *
 * `requestId` is `null` more often than not: openapi.yaml documents no
 * request-id header or field anywhere, so this is best-effort — populated
 * only when the server happens to send an `X-Request-Id` response header.
 */

export class KardinalError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    opts: { code: string; status: number; requestId: string | null; retryable: boolean }
  ) {
    super(message);
    this.name = new.target.name;
    this.code = opts.code;
    this.status = opts.status;
    this.requestId = opts.requestId;
    this.retryable = opts.retryable;
  }
}

/** `NOT_AUTHENTICATED` (401) or `NOT_ALLOWED` (403). */
export class KardinalAuthError extends KardinalError {}

/**
 * One of the 7 business codes returned under 400.
 * `.errors` carries every error object from the response envelope, not
 * just the first — a single 400 can report several invalid fields at once.
 */
export class KardinalValidationError extends KardinalError {
  readonly errors: Array<{ code: string; message: string }>;

  constructor(
    message: string,
    opts: {
      code: string;
      status: number;
      requestId: string | null;
      retryable: boolean;
      errors: Array<{ code: string; message: string }>;
    }
  ) {
    super(message, opts);
    this.errors = opts.errors;
  }
}

/** `NOT_FOUND` (404). Raised on every 404, including reads — no "get or null". */
export class KardinalNotFoundError extends KardinalError {}

/**
 * 429. Not documented in openapi.yaml as of this writing (no response
 * shape to parse a business `code`/`message` from), hence "outside the
 * envelope": `.code` is set to the synthetic value `"RATE_LIMITED"`.
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
 * A network-level failure (DNS, connection refused, fetch aborted, ...)
 * that never got an HTTP response at all, after retries were exhausted.
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
const AUTH_CODES = new Set(["NOT_AUTHENTICATED", "NOT_ALLOWED"]);

function familyForStatus(status: number): new (message: string, opts: any) => KardinalError {
  if (status === 401 || status === 403) return KardinalAuthError;
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
 * envelope at all).
 */
export function fromResponse(opts: {
  status: number;
  requestId: string | null;
  errors: Array<{ code: string; message: string }>;
}): KardinalError {
  const { status, requestId, errors } = opts;
  const code = errors[0]?.code ?? synthesizeCode(status);
  const message = errors[0]?.message ?? `HTTP ${status}`;
  const retryable = status === 429 || status >= 500;

  let Family: new (message: string, opts: any) => KardinalError;
  if (AUTH_CODES.has(code)) Family = KardinalAuthError;
  else if (VALIDATION_CODES.has(code)) Family = KardinalValidationError;
  else if (code === "NOT_FOUND") Family = KardinalNotFoundError;
  else if (code === "INTERNAL_SERVER_ERROR") Family = KardinalServerError;
  else Family = familyForStatus(status);

  if (Family === KardinalValidationError) {
    return new KardinalValidationError(message, { code, status, requestId, retryable, errors });
  }
  return new Family(message, { code, status, requestId, retryable });
}
