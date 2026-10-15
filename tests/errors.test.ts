import { describe, expect, it } from "vitest";
import {
  KardinalAuthError,
  KardinalConnectionError,
  KardinalForbiddenError,
  KardinalLimitError,
  KardinalNotFoundError,
  KardinalRateLimitError,
  KardinalServerError,
  KardinalTimeoutError,
  KardinalValidationError,
} from "../src/core/errors.js";

const LEAF_CLASSES = [
  KardinalAuthError,
  KardinalLimitError,
  KardinalForbiddenError,
  KardinalNotFoundError,
  KardinalRateLimitError,
  KardinalServerError,
  KardinalTimeoutError,
  KardinalConnectionError,
];

describe("error hierarchy", () => {
  it("every public error carries the required attributes", () => {
    for (const ErrClass of LEAF_CLASSES) {
      const err = new ErrClass("message", { code: "SOME_CODE", status: 400, requestId: "req-1", retryable: false });
      expect(err.code).toBe("SOME_CODE");
      expect(err.status).toBe(400);
      expect(err.requestId).toBe("req-1");
      expect(err.retryable).toBe(false);
      expect(err.warnings).toEqual([]);
      expect(err).toBeInstanceOf(Error);
    }
  });

  it("validation error also carries the full errors list", () => {
    const err = new KardinalValidationError("message", {
      code: "INVALID_VALUE",
      status: 400,
      requestId: null,
      retryable: false,
      errors: [{ code: "INVALID_VALUE", message: "bad" }],
    });
    expect(err.errors).toEqual([{ code: "INVALID_VALUE", message: "bad" }]);
  });
});

describe("error warnings", () => {
  it("validation error carries the amendments applied before it was raised", () => {
    const err = new KardinalValidationError("message", {
      code: "INVALID_VALUE",
      status: 400,
      requestId: null,
      retryable: false,
      errors: [{ code: "INVALID_VALUE", message: "bad" }],
      warnings: [{ code: "INVALID_VALUE", message: "clamped" }],
    });
    expect(err.warnings).toEqual([{ code: "INVALID_VALUE", message: "clamped" }]);
  });
});
