import { describe, expect, it } from "vitest";
import {
  KardinalAuthError,
  KardinalLimitError,
  KardinalNotFoundError,
  KardinalRateLimitError,
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
