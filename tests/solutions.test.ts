import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./setup.js";
import { pollIntervalMs } from "../src/routing/solutions.js";
import {
  Kardinal,
  KardinalAuthError,
  KardinalNotFoundError,
  KardinalOptimizationError,
  KardinalTimeoutError,
} from "../src/index.js";

const BASE = "https://app.kardinal.ai/api/v2";
const PLAN_ID = "4cbd0ab8-282c-4b30-b981-29e1ed8a2016";
const PLAN_URL = `${BASE}/plans/${PLAN_ID}`;

// Fake clock: a wait() that would take minutes runs instantly and
// deterministically. `elapsed()` is in seconds since the test started.
let t0 = 0;
beforeEach(() => {
  vi.useFakeTimers();
  t0 = Date.now();
});
afterEach(() => {
  vi.useRealTimers();
});
const elapsed = () => (Date.now() - t0) / 1000;

/** Runs `promise` to completion, advancing the fake clock as it goes. */
async function settle<T>(promise: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  let outcome: { value?: T; error?: unknown } | null = null;
  promise.then(
    (value) => (outcome = { value }),
    (error) => (outcome = { error })
  );
  while (outcome === null) await vi.advanceTimersByTimeAsync(500);
  return outcome;
}

function client() {
  return new Kardinal({ apiKey: "test-key", maxRetries: 0 });
}

function mockPlan(version = 1, budget: string | null = "PT6H") {
  const item: Record<string, unknown> = { id: PLAN_ID, resources: [], version };
  if (budget !== null) item.maxOptimizationDuration = budget;
  server.use(http.get(PLAN_URL, () => HttpResponse.json({ item })));
}

/** `timeline`: `[fromSecond, state, version]` entries; `/state` answers
 * with the last entry whose `fromSecond` has been reached. */
function mockStates(timeline: Array<[number, string, number]>) {
  const counter = { calls: 0 };
  server.use(
    http.get(`${PLAN_URL}/state`, () => {
      counter.calls += 1;
      const [, state, planVersion] = timeline.filter(([from]) => from <= elapsed()).at(-1)!;
      return HttpResponse.json({ item: { state, planVersion } });
    })
  );
  return counter;
}

function mockSolution(version = 1) {
  const counter = { calls: 0 };
  server.use(
    http.get(`${PLAN_URL}/solution`, () => {
      counter.calls += 1;
      return HttpResponse.json({ item: { planId: PLAN_ID, planVersion: version, tours: [] } });
    })
  );
  return counter;
}

const notFound = (details: string) =>
  HttpResponse.json(
    { errors: [{ code: "NOT_FOUND", message: "not found", properties: { details } }] },
    { status: 404 }
  );

describe("solutions.wait", () => {
  it("returns soon after the plan finishes, not after its budget", async () => {
    mockPlan(1, "PT6H");
    const states = mockStates([
      [0, "waiting", 1],
      [8, "optimizing", 1],
      [12, "optimized", 1],
    ]);
    const solutionCalls = mockSolution();

    const { value } = await settle(client().routing.solutions.wait(PLAN_ID));

    expect(value!.planId).toBe(PLAN_ID);
    expect(value!.finalState).toBe("optimized");
    expect(elapsed()).toBe(20);
    expect(states.calls).toBe(2);
    expect(solutionCalls.calls).toBe(1);
  });

  it("first polls after ten seconds, not immediately", async () => {
    // Right after start() the state is briefly still the previous run's
    // `optimized`: polling at t=0 would return a stale result.
    mockPlan();
    mockStates([[0, "optimized", 1]]);
    mockSolution();
    await settle(client().routing.solutions.wait(PLAN_ID));
    expect(elapsed()).toBe(10);
  });

  it("keeps waiting while /state still reports the previous version", async () => {
    mockPlan(2);
    mockStates([
      [0, "optimized", 1],
      [15, "processing", 2],
      [25, "optimized", 2],
    ]);
    mockSolution(2);
    const { value } = await settle(client().routing.solutions.wait(PLAN_ID));
    expect(value!.planVersion).toBe(2);
    expect(elapsed()).toBe(30);
  });

  it("rejects with PLAN_SUPERSEDED when a newer version was pushed", async () => {
    mockPlan(2);
    mockStates([[0, "waiting", 3]]);
    const { error } = await settle(client().routing.solutions.wait(PLAN_ID));
    expect(error).toBeInstanceOf(KardinalOptimizationError);
    expect((error as KardinalOptimizationError).code).toBe("PLAN_SUPERSEDED");
    expect((error as KardinalOptimizationError).planVersion).toBe(2);
  });

  it("rejects a solution left over from the previous version", async () => {
    // v2 stopped during processing: /solution still serves v1's result.
    mockPlan(2);
    mockStates([[0, "stopped", 2]]);
    mockSolution(1);
    const { error } = await settle(client().routing.solutions.wait(PLAN_ID));
    expect((error as KardinalOptimizationError).code).toBe("NO_SOLUTION");
    expect((error as KardinalOptimizationError).state).toBe("stopped");
  });

  it("after `stopped`, waits for `interrupted` while the solution improves", async () => {
    mockPlan();
    mockStates([
      [0, "stopped", 1],
      [25, "interrupted", 1],
    ]);
    const solutionCalls = mockSolution();
    const { value } = await settle(client().routing.solutions.wait(PLAN_ID));
    expect(value!.finalState).toBe("interrupted");
    expect(elapsed()).toBe(30);
    expect(solutionCalls.calls).toBe(2);
  });

  it("after `stopped`, gives up waiting for `interrupted` after a minute", async () => {
    mockPlan();
    mockStates([[0, "stopped", 1]]);
    mockSolution();
    const { value } = await settle(client().routing.solutions.wait(PLAN_ID));
    expect(value!.finalState).toBe("stopped");
    expect(elapsed()).toBeGreaterThanOrEqual(70);
    expect(elapsed()).toBeLessThanOrEqual(90);
  });

  it("follows a new run restarted during the `stopped` grace period", async () => {
    mockPlan();
    mockStates([
      [0, "stopped", 1],
      [15, "processing", 1],
      [35, "stopped", 1],
      [45, "interrupted", 1],
    ]);
    mockSolution();
    const { value } = await settle(client().routing.solutions.wait(PLAN_ID));
    expect(value!.finalState).toBe("interrupted");
  });

  it("rejects with NO_SOLUTION right away when stopped before any solution", async () => {
    mockPlan();
    mockStates([[0, "stopped", 1]]);
    server.use(http.get(`${PLAN_URL}/solution`, () => notFound("Solution version not found.")));
    const { error } = await settle(client().routing.solutions.wait(PLAN_ID));
    expect((error as KardinalOptimizationError).code).toBe("NO_SOLUTION");
    expect(elapsed()).toBe(10);
  });

  it("detects a deleted plan without reading the 404 text", async () => {
    // /state keeps answering after a DELETE: deletion shows up only on
    // /solution and /plans/{id}.
    let planCalls = 0;
    server.use(
      http.get(PLAN_URL, () => {
        planCalls += 1;
        return planCalls === 1
          ? HttpResponse.json({ item: { id: PLAN_ID, resources: [], version: 1 } })
          : notFound("Plan not found");
      }),
      http.get(`${PLAN_URL}/solution`, () => notFound("Plan not found"))
    );
    mockStates([[0, "interrupted", 1]]);
    const { error } = await settle(client().routing.solutions.wait(PLAN_ID));
    expect(error).toBeInstanceOf(KardinalNotFoundError);
    expect((error as Error).message).toMatch(/deleted/);
  });

  it("rejects with KardinalNotFoundError on the `deleted` state", async () => {
    mockPlan();
    mockStates([[0, "deleted", 1]]);
    const { error } = await settle(client().routing.solutions.wait(PLAN_ID));
    expect(error).toBeInstanceOf(KardinalNotFoundError);
    expect((error as Error).message).toMatch(/deleted/);
  });

  it("rejects with OPTIMIZATION_STALLED when optimizing outlasts its budget by five minutes", async () => {
    mockPlan(1, "PT5S");
    mockStates([
      [0, "processing", 1],
      [20, "optimizing", 1],
    ]);
    const { error } = await settle(client().routing.solutions.wait(PLAN_ID));
    expect((error as KardinalOptimizationError).code).toBe("OPTIMIZATION_STALLED");
    expect((error as KardinalOptimizationError).state).toBe("optimizing");
    expect(elapsed() - 20).toBeGreaterThan(305);
    expect(elapsed() - 20).toBeLessThan(305 + 60);
  });

  it("has no stall guard without a budget", async () => {
    mockPlan(1, null);
    mockStates([
      [0, "optimizing", 1],
      [5000, "optimized", 1],
    ]);
    mockSolution();
    const { value } = await settle(client().routing.solutions.wait(PLAN_ID));
    expect(value!.finalState).toBe("optimized");
  });

  it.each([
    ["429", () => new HttpResponse(null, { status: 429 })],
    ["503", () => new HttpResponse(null, { status: 503 })],
    ["network", () => HttpResponse.error()],
  ])("rides out transient failures (%s)", async (_name, failure) => {
    mockPlan();
    let calls = 0;
    server.use(
      http.get(`${PLAN_URL}/state`, () => {
        calls += 1;
        if (calls <= 5) return failure();
        return HttpResponse.json({ item: { state: "optimized", planVersion: 1 } });
      })
    );
    mockSolution();
    const { value } = await settle(client().routing.solutions.wait(PLAN_ID));
    expect(value!.finalState).toBe("optimized");
  });

  it("does not swallow auth errors", async () => {
    mockPlan();
    server.use(
      http.get(`${PLAN_URL}/state`, () =>
        HttpResponse.json({ errors: [{ code: "NOT_AUTHENTICATED", message: "no" }] }, { status: 401 })
      )
    );
    const { error } = await settle(client().routing.solutions.wait(PLAN_ID));
    expect(error).toBeInstanceOf(KardinalAuthError);
  });

  it("checks the state once more before timing out", async () => {
    mockPlan();
    const states = mockStates([[0, "optimized", 1]]);
    mockSolution();
    const { value } = await settle(client().routing.solutions.wait(PLAN_ID, 3_000));
    expect(value!.finalState).toBe("optimized");
    expect(states.calls).toBe(1);
    expect(elapsed()).toBe(3);
  });

  it("rejects with KardinalTimeoutError naming the last state seen", async () => {
    mockPlan();
    const states = mockStates([[0, "processing", 1]]);
    const { error } = await settle(client().routing.solutions.wait(PLAN_ID, 25_000));
    expect(error).toBeInstanceOf(KardinalTimeoutError);
    expect((error as Error).message).toMatch(/processing/);
    expect(elapsed()).toBe(25);
    expect(states.calls).toBe(3);
  });

  it("still polls once with a zero timeout", async () => {
    mockPlan();
    const states = mockStates([[0, "waiting", 1]]);
    const { error } = await settle(client().routing.solutions.wait(PLAN_ID, 0));
    expect(error).toBeInstanceOf(KardinalTimeoutError);
    expect(states.calls).toBe(1);
  });
});

describe("solutions.getObjectives", () => {
  it("returns a plain array", async () => {
    server.use(
      http.get(`${PLAN_URL}/solution/objectives`, () =>
        HttpResponse.json({ items: [{ name: "minimizeCosts", priority: 0, direction: "minimize", value: 12.5 }] })
      )
    );
    const objectives = await client().routing.solutions.getObjectives(PLAN_ID);
    expect(objectives[0].name).toBe("minimizeCosts");
  });
});

describe("solutions warnings", () => {
  it("get() copies the envelope's warnings onto the solution", async () => {
    server.use(
      http.get(`${PLAN_URL}/solution`, () =>
        HttpResponse.json({
          item: { planId: PLAN_ID, planVersion: 1 },
          warnings: [{ code: "INVALID_VALUE", message: "crow-fly distances" }],
        })
      )
    );
    const solution = await client().routing.solutions.get(PLAN_ID);
    expect(solution.warnings.map((w) => w.code)).toEqual(["INVALID_VALUE"]);
  });

  it("getObjectives() attaches the envelope's warnings to the array", async () => {
    server.use(
      http.get(`${PLAN_URL}/solution/objectives`, () =>
        HttpResponse.json({ items: [], warnings: [{ code: "INVALID_VALUE", message: "m" }] })
      )
    );
    const objectives = await client().routing.solutions.getObjectives(PLAN_ID);
    expect(objectives).toHaveLength(0);
    expect(objectives.warnings.map((w) => w.code)).toEqual(["INVALID_VALUE"]);
  });

  it("getObjectives() defaults warnings to an empty array", async () => {
    server.use(http.get(`${PLAN_URL}/solution/objectives`, () => HttpResponse.json({ items: [] })));
    expect((await client().routing.solutions.getObjectives(PLAN_ID)).warnings).toEqual([]);
  });
});

describe("pollIntervalMs", () => {
  it.each([
    [0, 10],
    [50, 10],
    [100, 10],
    [300, 30],
    [600, 60],
    [7200, 60],
  ])("after %is waited, polls every %is (10%% of elapsed, between 10s and 60s)", (elapsed, expected) => {
    expect(pollIntervalMs(elapsed * 1000)).toBe(expected * 1000);
  });
});
