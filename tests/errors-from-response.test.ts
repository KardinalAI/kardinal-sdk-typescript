import { describe, expect, it } from "vitest";
import {
  KardinalAuthError,
  KardinalConnectionError,
  KardinalLimitError,
  KardinalNotFoundError,
  KardinalRateLimitError,
  KardinalServerError,
  KardinalValidationError,
  fromResponse,
} from "../src/core/errors.js";

const error = (code: string, details?: string) => [
  { code, message: `${code} message`, ...(details ? { properties: { details } } : {}) },
];

describe("fromResponse", () => {
  it("maps a 401 to KardinalAuthError", () => {
    const err = fromResponse({ status: 401, requestId: null, errors: error("NOT_AUTHENTICATED") });
    expect(err).toBeInstanceOf(KardinalAuthError);
    expect(err.code).toBe("NOT_AUTHENTICATED");
  });

  it("maps NOT_ALLOWED to KardinalLimitError, not KardinalAuthError", () => {
    // For a builder account a 403 always means an agency limit was reached
    // (see NOT_ALLOWED in openapi.yaml), never a permission refusal.
    const err = fromResponse({
      status: 403,
      requestId: null,
      errors: error("NOT_ALLOWED", "Insufficient credits"),
    });
    expect(err).toBeInstanceOf(KardinalLimitError);
    expect(err).not.toBeInstanceOf(KardinalAuthError);
    expect(err.code).toBe("NOT_ALLOWED");
    expect(err.details).toBe("Insufficient credits");
  });

  it("takes code and details from the error that explains a plan-size 403", () => {
    // The plan-size example of openapi.yaml: the FIRST error is the
    // INVALID_VALUE naming the field, then the NOT_ALLOWED making it a 403.
    const errors = [
      {
        code: "INVALID_VALUE",
        message: "The field value is not valid.",
        properties: {
          details: "The plan's number of resources (251) is greater than the allowed value (250)",
          path: "resources",
        },
      },
      {
        code: "NOT_ALLOWED",
        message: "The requested action is not allowed.",
        properties: { details: "The resulting plan violates the quotas configuration of the agency" },
      },
    ];
    const err = fromResponse({ status: 403, requestId: null, errors });
    expect(err).toBeInstanceOf(KardinalLimitError);
    expect(err.code).toBe("NOT_ALLOWED");
    expect(err.message).toBe("The requested action is not allowed.");
    expect(err.details).toBe("The resulting plan violates the quotas configuration of the agency");
    expect(err.errors).toEqual(errors);
  });

  it("keeps a future 403 code in KardinalLimitError", () => {
    const errors = [
      { code: "INVALID_VALUE", message: "bad", properties: { path: "resources" } },
      { code: "QUOTA_EXCEEDED", message: "quota" },
    ];
    const err = fromResponse({ status: 403, requestId: null, errors });
    expect(err).toBeInstanceOf(KardinalLimitError);
    expect(err.code).toBe("QUOTA_EXCEEDED");
  });

  it.each([
    "INVALID_INPUT",
    "ID_NOT_UNIQUE",
    "KEYS_NOT_UNIQUE",
    "INVALID_ID_REFERENCE",
    "INVALID_VALUE",
    "PRECONDITION_FAILED",
    "NOT_IMPLEMENTED",
  ])("maps the 400 code %s to KardinalValidationError", (code) => {
    const err = fromResponse({ status: 400, requestId: null, errors: error(code) });
    expect(err).toBeInstanceOf(KardinalValidationError);
    expect(err.code).toBe(code);
  });

  it("tells two 404s apart with details", () => {
    const err = fromResponse({
      status: 404,
      requestId: null,
      errors: error("NOT_FOUND", "Solution version not found."),
    });
    expect(err).toBeInstanceOf(KardinalNotFoundError);
    expect(err.details).toBe("Solution version not found.");
  });

  it("maps an empty-body 429 to KardinalRateLimitError", () => {
    const err = fromResponse({ status: 429, requestId: null, errors: [] });
    expect(err).toBeInstanceOf(KardinalRateLimitError);
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.errors).toEqual([]);
    expect(err.details).toBeNull();
  });

  it("carries the warnings of the envelope", () => {
    const warnings = [{ code: "INVALID_VALUE", message: "amended" }];
    const err = fromResponse({ status: 400, requestId: null, errors: error("INVALID_VALUE"), warnings });
    expect(err.warnings).toEqual(warnings);
  });
});

describe("fromResponse families and flags", () => {
  const none = (status: number, method?: string) => fromResponse({ status, requestId: null, errors: [], method });

  it("maps INTERNAL_SERVER_ERROR to KardinalServerError", () => {
    expect(fromResponse({ status: 500, requestId: null, errors: error("INTERNAL_SERVER_ERROR") })).toBeInstanceOf(
      KardinalServerError
    );
  });

  it("falls back to the family matching the HTTP status for an unknown code", () => {
    // openapi.yaml says new business codes may be added in a future
    // non-breaking release: an unknown code must not disappear.
    const err = fromResponse({ status: 404, requestId: null, errors: error("SOME_FUTURE_CODE") });
    expect(err).toBeInstanceOf(KardinalNotFoundError);
    expect(err.code).toBe("SOME_FUTURE_CODE");
  });

  it.each([
    [401, KardinalAuthError],
    [403, KardinalLimitError],
    [404, KardinalNotFoundError],
    [429, KardinalRateLimitError],
    [500, KardinalServerError],
    [502, KardinalServerError],
    [418, KardinalValidationError], // anything else defaults to validation
  ])("maps status %i to its family", (status, Family) => {
    expect(fromResponse({ status, requestId: null, errors: error("SOME_FUTURE_CODE") })).toBeInstanceOf(Family);
  });

  it.each([
    [401, "NOT_AUTHENTICATED"],
    [403, "NOT_ALLOWED"],
    [404, "NOT_FOUND"],
    [429, "RATE_LIMITED"],
    [500, "INTERNAL_SERVER_ERROR"],
    [418, "INVALID_INPUT"],
  ])("synthesizes a code for a %i without an error envelope", (status, code) => {
    const err = none(status);
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
  });

  it("falls back to synthetic values for an error entry without code or message", () => {
    const err = fromResponse({ status: 404, requestId: null, errors: [{ properties: {} } as any] });
    expect(err).toBeInstanceOf(KardinalNotFoundError);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("HTTP 404");
  });

  it.each([429, 500, 502, 503])("is retryable for a %i", (status) => {
    expect(none(status).retryable).toBe(true);
  });

  it.each([400, 401, 403, 404])("is not retryable for a %i", (status) => {
    expect(none(status).retryable).toBe(false);
  });

  it("never builds a KardinalConnectionError (client-side only)", () => {
    for (const status of [401, 404, 429, 500]) expect(none(status)).not.toBeInstanceOf(KardinalConnectionError);
  });

  it("has null details when the first error has no properties", () => {
    expect(fromResponse({ status: 404, requestId: null, errors: error("NOT_FOUND") }).details).toBeNull();
  });

  it("a 5xx on POST is not retryable, on GET/PUT/DELETE it is", () => {
    // The plan may have been created before the server failed: resubmitting
    // could create (and bill) it twice. `retryable` means "safe to retry".
    expect(none(500, "POST")).toBeInstanceOf(KardinalServerError);
    expect(none(500, "POST").retryable).toBe(false);
    for (const method of ["GET", "PUT", "DELETE"]) expect(none(503, method).retryable).toBe(true);
  });

  it("a 429 is retryable even on POST", () => {
    // The 429 comes from the cluster before any processing: nothing was created.
    expect(none(429, "POST").retryable).toBe(true);
  });
});

describe("fromResponse with empty values", () => {
  it("synthesizes the code and message when they're empty strings", () => {
    const err = fromResponse({ status: 404, requestId: null, errors: [{ code: "", message: "" }] });
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("HTTP 404");
  });
});
