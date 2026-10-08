/**
 * The server says when its limit lifts; the SDK used to ignore it and back
 * off on a schedule of its own, which is how a client stays throttled
 * longer than it had to be.
 */
import { describe, expect, it } from "vitest";
import { backoffMs, retryAfterMs, retryDelayMs, isRetryable } from "../src/core/retry.js";

describe("Retry-After", () => {
  it("reads the delay-seconds form", () => {
    expect(retryAfterMs("3")).toBe(3000);
    expect(retryAfterMs("  3  ")).toBe(3000);
    expect(retryAfterMs("0")).toBe(0);
  });

  it("reads the HTTP-date form", () => {
    const inTwoSeconds = new Date(Date.now() + 2000).toUTCString();
    const read = retryAfterMs(inTwoSeconds);
    expect(read).toBeGreaterThan(500);
    expect(read).toBeLessThanOrEqual(2000);
  });

  it("treats a date already past as 'now', not as a negative wait", () => {
    expect(retryAfterMs(new Date(Date.now() - 5000).toUTCString())).toBe(0);
  });

  it("caps an absurd value instead of trusting it", () => {
    // A bad header must not park a caller for a day.
    expect(retryAfterMs("99999")).toBe(60_000);
  });

  it("ignores a header it can't read", () => {
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("")).toBeNull();
    expect(retryAfterMs("soon")).toBeNull();
    expect(retryAfterMs("-5")).toBeNull();
  });

  it("wins over the SDK's own backoff", () => {
    expect(retryDelayMs(1, "3")).toBe(3000);
    expect(retryDelayMs(4, "1")).toBe(1000);
  });

  it("falls back to backoff when the server said nothing", () => {
    const delay = retryDelayMs(1, null);
    expect(delay).toBeGreaterThanOrEqual(250);
    expect(delay).toBeLessThanOrEqual(500);
  });
});

describe("backoff", () => {
  it("is jittered, so throttled clients don't retry in lockstep", () => {
    const seen = new Set(Array.from({ length: 50 }, () => backoffMs(3)));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("keeps a floor and a ceiling at every attempt", () => {
    for (const [attempt, ceiling] of [
      [1, 500],
      [2, 1000],
      [3, 2000],
      [9, 8000], // capped
    ] as const) {
      for (let i = 0; i < 20; i++) {
        const delay = backoffMs(attempt);
        expect(delay).toBeGreaterThanOrEqual(ceiling / 2);
        expect(delay).toBeLessThanOrEqual(ceiling);
      }
    }
  });
});

describe("what gets retried", () => {
  it("never retries POST, which has no idempotency key", () => {
    expect(isRetryable("POST", { status: 503, networkError: false })).toBe(false);
    expect(isRetryable("POST", { status: null, networkError: true })).toBe(false);
  });

  it("retries a read, a replace or a delete on 429 and 5xx", () => {
    for (const method of ["GET", "PUT", "DELETE"]) {
      expect(isRetryable(method, { status: 429, networkError: false })).toBe(true);
      expect(isRetryable(method, { status: 503, networkError: false })).toBe(true);
      expect(isRetryable(method, { status: 404, networkError: false })).toBe(false);
    }
  });
});
