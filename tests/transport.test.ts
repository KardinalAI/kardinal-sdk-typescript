import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse, passthrough } from "msw";
import { server } from "./setup.js";
import {
  KardinalConnectionError,
  KardinalError,
  KardinalServerError,
  KardinalValidationError,
} from "../src/core/errors.js";
import { DEFAULT_BASE_URL, Transport, resolveBaseUrl } from "../src/core/transport.js";

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

describe("error bodies", () => {
  for (const body of ["null", "[1, 2]", '"oops"']) {
    it(`falls back to empty errors when the JSON body is ${body}`, async () => {
      server.use(http.get(`${BASE}/plans/p1`, () => new HttpResponse(body, { status: 500 })));
      const err = await rejection(transport().request("GET", "/plans/p1"));
      expect(err).toBeInstanceOf(KardinalServerError);
      expect(err.code).toBe("INTERNAL_SERVER_ERROR");
      expect(err.errors).toEqual([]);
    });
  }

  it("reports a 3xx as an error instead of following it", async () => {
    server.use(
      http.get(`${BASE}/plans/p1`, () => new HttpResponse(null, { status: 302, headers: { Location: "/elsewhere" } }))
    );
    const err = await rejection(transport().request("GET", "/plans/p1"));
    expect(err).toBeInstanceOf(KardinalValidationError);
    expect(err.status).toBe(302);
  });
});

describe("request headers", () => {
  it("identify the SDK, and send Content-Type only with a body", async () => {
    const seen: Headers[] = [];
    server.use(
      http.get(`${BASE}/plans/p1`, ({ request }) => {
        seen.push(request.headers);
        return HttpResponse.json({});
      }),
      http.post(`${BASE}/plans`, ({ request }) => {
        seen.push(request.headers);
        return HttpResponse.json({});
      })
    );
    await transport().request("GET", "/plans/p1");
    await transport().request("POST", "/plans", { json: {} });
    const [get, post] = seen;
    expect(get.get("X-Kardinal-Client")).toMatch(/^kardinal-sdk-typescript\/\S+$/);
    expect(get.get("User-Agent")).toMatch(/^kardinal-sdk-typescript\/\S+ \(Node\/\d[\d.]*; (Linux|Darwin|Windows)\/\S+\)( undici\/\S+)?$/);
    expect(get.get("Content-Type")).toBeNull();
    expect(post.get("Content-Type")).toBe("application/json");
  });
});

describe("resolveBaseUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers the explicit option", () => {
    vi.stubEnv("KARDINAL_BASE_URL", "https://from-env.example/api/v2");
    expect(resolveBaseUrl("https://from-arg.example/api/v2")).toBe("https://from-arg.example/api/v2");
  });

  it("falls back to KARDINAL_BASE_URL", () => {
    vi.stubEnv("KARDINAL_BASE_URL", "https://from-env.example/api/v2");
    expect(resolveBaseUrl(undefined)).toBe("https://from-env.example/api/v2");
  });

  it("falls back to production", () => {
    vi.stubEnv("KARDINAL_BASE_URL", "");
    expect(resolveBaseUrl(undefined)).toBe(DEFAULT_BASE_URL);
  });
});

describe("retries", () => {
  afterEach(() => vi.useRealTimers());

  /** Runs `promise` to completion, advancing the fake clock through backoffs. */
  async function settle<T>(promise: Promise<T>): Promise<T> {
    let outcome: { value?: T; error?: unknown } | null = null;
    promise.then(
      (value) => (outcome = { value }),
      (error) => (outcome = { error })
    );
    while (outcome === null) await vi.advanceTimersByTimeAsync(500);
    const { value, error } = outcome as { value?: T; error?: unknown };
    if (error !== undefined) throw error;
    return value as T;
  }

  it("retries a GET after a 5xx, then succeeds", async () => {
    vi.useFakeTimers();
    let calls = 0;
    server.use(
      http.get(`${BASE}/plans/p1`, () => {
        calls += 1;
        return calls === 1 ? new HttpResponse(null, { status: 503 }) : HttpResponse.json({ item: { id: "p1" } });
      })
    );
    expect(await settle(transport(3).request("GET", "/plans/p1"))).toEqual({ item: { id: "p1" } });
    expect(calls).toBe(2);
  });

  it("gives up after maxRetries", async () => {
    vi.useFakeTimers();
    let calls = 0;
    server.use(
      http.get(`${BASE}/plans/p1`, () => {
        calls += 1;
        return new HttpResponse(null, { status: 503 });
      })
    );
    await expect(settle(transport(2).request("GET", "/plans/p1"))).rejects.toBeInstanceOf(KardinalServerError);
    expect(calls).toBe(3);
  });

  it("retries a network error, then raises KardinalConnectionError", async () => {
    vi.useFakeTimers();
    let calls = 0;
    server.use(
      http.get(`${BASE}/plans/p1`, () => {
        calls += 1;
        return HttpResponse.error();
      })
    );
    await expect(settle(transport(2).request("GET", "/plans/p1"))).rejects.toBeInstanceOf(KardinalConnectionError);
    expect(calls).toBe(3);
  });
});

describe("empty and non-JSON responses", () => {
  it("returns null for a 204", async () => {
    server.use(http.delete(`${BASE}/plans/p1`, () => new HttpResponse(null, { status: 204 })));
    expect(await transport().request("DELETE", "/plans/p1")).toBeNull();
  });

  it("synthesizes the code of an error response whose body isn't JSON", async () => {
    server.use(http.get(`${BASE}/plans/p1`, () => new HttpResponse("not json", { status: 500 })));
    const err = await rejection(transport().request("GET", "/plans/p1"));
    expect(err).toBeInstanceOf(KardinalServerError);
    expect(err.code).toBe("INTERNAL_SERVER_ERROR");
  });
});

describe("malformed error bodies", () => {
  for (const errors of ['"oops"', '["oops", 1]', '{"code": "X"}']) {
    it(`ignores errors: ${errors}`, async () => {
      server.use(http.get(`${BASE}/plans/p1`, () => new HttpResponse(`{"errors": ${errors}}`, { status: 404 })));
      const err = await rejection(transport().request("GET", "/plans/p1"));
      expect(err.code).toBe("NOT_FOUND");
      expect(err.errors).toEqual([]);
      expect(err.details).toBeNull();
    });
  }

  it("carries the envelope's warnings on the error", async () => {
    const warnings = [{ code: "INVALID_VALUE", message: "amended" }];
    server.use(
      http.post(`${BASE}/plans`, () =>
        HttpResponse.json({ errors: [{ code: "INVALID_VALUE", message: "bad" }], warnings }, { status: 400 })
      )
    );
    const err = await rejection(transport().request("POST", "/plans", { json: {} }));
    expect(err).toBeInstanceOf(KardinalValidationError);
    expect(err.warnings).toEqual(warnings);
  });
});

describe("connect timeout", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is retryable even on POST: the request was never sent", async () => {
    const cause = Object.assign(new Error("connect timeout"), { code: "UND_ERR_CONNECT_TIMEOUT" });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed", { cause }));
    const err = await rejection(transport().request("POST", "/plans", { json: {} }));
    expect(err).toBeInstanceOf(KardinalConnectionError);
    expect(err.retryable).toBe(true);
  });
});
