import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./setup.js";
import { Kardinal, KardinalTimeoutError } from "../src/index.js";

const BASE = "https://app.kardinal.ai/api/v2";
const PLAN_ID = "4cbd0ab8-282c-4b30-b981-29e1ed8a2016";

describe("solutions.wait", () => {
  it("polls until a terminal state, then returns the solution", async () => {
    let stateCalls = 0;
    server.use(
      http.get(`${BASE}/plans/${PLAN_ID}`, () =>
        HttpResponse.json({ item: { id: PLAN_ID, resources: [], maxOptimizationDuration: "PT0S" } })
      ),
      http.get(`${BASE}/plans/${PLAN_ID}/state`, () => {
        stateCalls += 1;
        const state = stateCalls < 2 ? "optimizing" : "optimized";
        return HttpResponse.json({ item: { state } });
      }),
      http.get(`${BASE}/plans/${PLAN_ID}/solution`, () =>
        HttpResponse.json({ item: { planId: PLAN_ID, tours: [] } })
      )
    );
    const k = new Kardinal({ apiKey: "test-key" });
    const solution = await k.routing.solutions.wait(PLAN_ID);
    expect(solution.planId).toBe(PLAN_ID);
    expect(stateCalls).toBeGreaterThanOrEqual(2);
  });

  it("rejects with KardinalTimeoutError when the hard timeout elapses", async () => {
    server.use(
      http.get(`${BASE}/plans/${PLAN_ID}`, () =>
        HttpResponse.json({ item: { id: PLAN_ID, resources: [], maxOptimizationDuration: "PT1H" } })
      )
    );
    const k = new Kardinal({ apiKey: "test-key" });
    await expect(k.routing.solutions.wait(PLAN_ID, 0)).rejects.toBeInstanceOf(KardinalTimeoutError);
  });

  it("getObjectives returns a plain array", async () => {
    server.use(
      http.get(`${BASE}/plans/${PLAN_ID}/solution/objectives`, () =>
        HttpResponse.json({ items: [{ name: "minimizeCosts", priority: 0, direction: "minimize", value: 12.5 }] })
      )
    );
    const k = new Kardinal({ apiKey: "test-key" });
    const objectives = await k.routing.solutions.getObjectives(PLAN_ID);
    expect(objectives[0].name).toBe("minimizeCosts");
  });
});
