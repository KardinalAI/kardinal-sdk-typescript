import { describe, expect, it } from "vitest";
import { http, HttpResponse, passthrough } from "msw";
import { server } from "./setup.js";
import { KardinalConnectionError, KardinalError, KardinalServerError } from "../src/core/errors.js";
import { Transport } from "../src/core/transport.js";

const BASE = "https://app.kardinal.ai/api/v2";

function transport(maxRetries = 0, baseUrl?: string) {
  return new Transport({ apiKey: "test-key", maxRetries, baseUrl });
}

async function rejection(promise: Promise<unknown>): Promise<KardinalError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(KardinalError);
    return e as KardinalError;
  }
  throw new Error("expected a rejection");
}

describe("retryable", () => {
  it("is false for a 5xx on POST, which is never retried automatically", async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/plans`, () => {
        calls += 1;
        return new HttpResponse(null, { status: 500 });
      })
    );
    const err = await rejection(transport(3).request("POST", "/plans", { json: {} }));
    expect(err).toBeInstanceOf(KardinalServerError);
    expect(err.retryable).toBe(false);
    expect(calls).toBe(1);
  });

  it("is true for a 5xx on GET, after the automatic retries", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/plans/p1`, () => {
        calls += 1;
        return new HttpResponse(null, { status: 503 });
      })
    );
    const err = await rejection(transport(1).request("GET", "/plans/p1"));
    expect(err.retryable).toBe(true);
    expect(calls).toBe(2); // initial attempt + 1 retry
  });

  it("is true for a 429, even on POST", async () => {
    server.use(http.post(`${BASE}/plans`, () => new HttpResponse(null, { status: 429 })));
    const err = await rejection(transport().request("POST", "/plans", { json: {} }));
    expect(err.retryable).toBe(true);
  });

  it("is true on POST when the connection never opened", async () => {
    // A real refused connection (nothing listens on this port): Node's
    // fetch reports ECONNREFUSED, so the request was never sent.
    const base = "http://127.0.0.1:59999/api/v2";
    server.use(http.post(`${base}/plans`, () => passthrough()));
    const err = await rejection(transport(0, base).request("POST", "/plans", { json: {} }));
    expect(err).toBeInstanceOf(KardinalConnectionError);
    expect(err.retryable).toBe(true);
  });

  it("is false on POST when the response may have been lost after sending", async () => {
    server.use(http.post(`${BASE}/plans`, () => HttpResponse.error()));
    const err = await rejection(transport().request("POST", "/plans", { json: {} }));
    expect(err).toBeInstanceOf(KardinalConnectionError);
    expect(err.retryable).toBe(false);
  });

  it("is true on GET for any connection error", async () => {
    server.use(http.get(`${BASE}/plans/p1`, () => HttpResponse.error()));
    const err = await rejection(transport().request("GET", "/plans/p1"));
    expect(err).toBeInstanceOf(KardinalConnectionError);
    expect(err.retryable).toBe(true);
  });
});

describe("response bodies", () => {
  it("raises a KardinalError for a 2xx with a non-JSON body", async () => {
    server.use(
      http.get(`${BASE}/plans/p1`, () => new HttpResponse("not json", { status: 200 }))
    );
    const err = await rejection(transport().request("GET", "/plans/p1"));
    expect(err.code).toBe("INVALID_RESPONSE_BODY");
    expect(err.status).toBe(200);
  });
});
