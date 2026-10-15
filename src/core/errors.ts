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
 *
 * A 403 is a limit by default (`KardinalLimitError`). Two 403s that are not
 * limits are recognised by the exact text of their `details`: a revoked or
 * regenerated key (`KardinalAuthError`) and an archived plan updated, stopped or restarted without
 * `force` (`KardinalValidationError`). Any other 403 (an unknown message, a
 * rejected scope or claim) stays a `KardinalLimitError`.
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

/**
 * `NOT_AUTHENTICATED` (401): the API key is missing, malformed, or
 * expired, or was issued for another environment. Also raised for a 403
 * `NOT_ALLOWED` whose `details` is `the token is invalid`: a key revoked or
 * regenerated (`.status` is 403 then, `.code` `NOT_ALLOWED`).
 */
export class KardinalAuthError extends KardinalError {}

/**
 * A 403 (`NOT_ALLOWED`) that is a limit of the agency — a plan-size
 * limit (resources, orders, stops, stops per order without
 * `successiveStops`), the daily/monthly optimization quota, or exhausted
 * credits. This is the default for a 403: the two 403s that are known not
 * to be limits (a revoked key, an archived plan updated, stopped or restarted without `force`)
 * raise `KardinalAuthError` and `KardinalValidationError`. Any other 403
 * lands here too, including the ones the API may add and the rejection of a
 * scope or a claim, which are not recognised separately.
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
 *
 * Also raised for a 403 `NOT_ALLOWED` whose `details` says an archived plan
 * can't be updated, stopped or restarted without `force`: fix the request by
 * adding `force=true`. Unlike other validation errors, this one has no field
 * path in `.errors`.
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
 * The hard `timeoutMs` guard on `solutions.wait()` elapsed before the plan
 * reached a final state (checked one last time right at the deadline).
 * Client-side only — no HTTP response backs it.
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

/** The part of `UnknownField` a message needs. Structural, so this module
 * stays free of imports from `routing/`, which imports it. */
type UnknownFieldLike = { path: string; suggestion?: string; serverAssigned?: boolean };

/** What to tell the caller about one unknown key, or `undefined` when there
 * is nothing useful to say. One definition, so the error, the CLI and any
 * caller running the check themselves word it the same way.
 */
export function hintFor(field: UnknownFieldLike): string | undefined {
  // A plan read back and resubmitted carries these; they are not typos, and
  // the nearest declared name would be misleading advice.
  if (field.serverAssigned) return "not a field you set: the server assigns it";
  return field.suggestion ? `did you mean ${field.suggestion}?` : undefined;
}

function describe(field: UnknownFieldLike): string {
  const hint = hintFor(field);
  return hint ? `  (${hint})` : "";
}

/** A key no schema declares was found in a plan being sent.
 *
 * Almost always a misspelled optional field. The API drops such a key
 * without complaining, so the field it was meant to set stays unset and the
 * plan is optimized without it: a stop with a misspelled `operationDuration`
 * takes no time, an order with a misspelled `requiredSkills` can go on any
 * resource. Thrown by `submit()` on any such key, and by `update()` on one
 * the server didn't send, before the request leaves — nothing downstream
 * will report it.
 */
export class UnknownFieldError extends KardinalError {
  /** Every unknown key, with its path and, when the name is close to a
   * real field, what it was probably meant to be. */
  readonly fields: ReadonlyArray<UnknownFieldLike>;

  constructor(fields: ReadonlyArray<UnknownFieldLike>) {
    const listed = fields.map((f) => `  ${f.path}${describe(f)}`).join("\n");
    super(`Unknown field(s) in the plan:\n${listed}`, {
      code: "UNKNOWN_FIELD",
      status: 0,
      requestId: null,
      retryable: false,
    });
    this.name = "UnknownFieldError";
    this.fields = fields;
  }

  /** Just the paths, for a quick assertion or log line. */
  get paths(): string[] {
    return this.fields.map((f) => f.path);
  }
}

const VALIDATION_CODES = new Set([
  "INVALID_INPUT",
  "ID_NOT_UNIQUE",
  "KEYS_NOT_UNIQUE",
  "INVALID_ID_REFERENCE",
  "INVALID_VALUE",
  "PRECONDITION_FAILED",
  "NOT_IMPLEMENTED",
]);
// The two 403 messages that are not limits. Each is an exact match on the
// `properties.details` of the NOT_ALLOWED error, copied from the backend; if
// the backend rewords one, the 403 falls back to KardinalLimitError.
// Revoked or regenerated key.
const REVOKED_TOKEN_DETAILS = "the token is invalid";
// Archived plan updated, stopped or restarted without `force`.
const ARCHIVED_PLAN_DETAILS = "Cannot update an archived plan, except with the 'force' query param";
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
  const code = primary?.code || synthesizeCode(status);
  const message = primary?.message || `HTTP ${status}`;
  const retryable = status === 429 || (status >= 500 && method.toUpperCase() !== "POST");

  let Family: ErrorClass;
  if (status === 403) {
    const details = primary?.properties?.details;
    if (code === "NOT_ALLOWED" && details === REVOKED_TOKEN_DETAILS) Family = KardinalAuthError;
    else if (code === "NOT_ALLOWED" && details === ARCHIVED_PLAN_DETAILS) Family = KardinalValidationError;
    else Family = KardinalLimitError;
  } else if (AUTH_CODES.has(code)) Family = KardinalAuthError;
  else if (VALIDATION_CODES.has(code)) Family = KardinalValidationError;
  else if (code === "NOT_FOUND") Family = KardinalNotFoundError;
  else if (code === "INTERNAL_SERVER_ERROR") Family = KardinalServerError;
  else Family = familyForStatus(status);

  return new Family(message, { code, status, requestId, retryable, errors, warnings });
}
