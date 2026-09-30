/**
 * The quickstart from the README, run end to end against a mocked
 * transport.
 */
import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./setup.js";
import { Kardinal, examples } from "../src/index.js";

const BASE = "https://app.kardinal.ai/api/v2";
const PLAN_ID = "4cbd0ab8-282c-4b30-b981-29e1ed8a2016";

describe("README quickstart", () => {
  it("runs end to end", async () => {
    server.use(
      http.post(`${BASE}/plans`, () =>
        HttpResponse.json({ item: { id: PLAN_ID, resources: [] } }, { status: 201 })
      ),
      http.get(`${BASE}/plans/${PLAN_ID}`, () =>
        HttpResponse.json({ item: { id: PLAN_ID, resources: [], maxOptimizationDuration: "PT0S" } })
      ),
      http.get(`${BASE}/plans/${PLAN_ID}/state`, () => HttpResponse.json({ item: { state: "optimized" } })),
      http.get(`${BASE}/plans/${PLAN_ID}/solution`, () =>
        HttpResponse.json({ item: { planId: PLAN_ID, tours: [] } })
      )
    );

    // wait() first polls after 10s: a fake clock keeps the test instant.
    vi.useFakeTimers();
    try {
      const k = new Kardinal({ apiKey: "test-key" });
      const plan = await k.routing.plans.submit(examples.smallDeliveryPlan());
      const waiting = k.routing.solutions.wait(plan.id);
      await vi.advanceTimersByTimeAsync(10_000);
      const solution = await waiting;

      expect(plan.id).toBe(PLAN_ID);
      expect(solution.tours).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
