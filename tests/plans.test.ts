import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./setup.js";
import { Kardinal, KardinalNotFoundError, KardinalConnectionError } from "../src/index.js";

const BASE = "https://app.kardinal.ai/api/v2";
const PLAN_ID = "4cbd0ab8-282c-4b30-b981-29e1ed8a2016";

function client() {
  return new Kardinal({ apiKey: "test-key" });
}

describe("plans", () => {
  it("submit() returns a plan with id", async () => {
    server.use(
      http.post(`${BASE}/plans`, () =>
        HttpResponse.json({ item: { id: PLAN_ID, resources: [] } }, { status: 201 })
      )
    );
    const plan = await client().routing.plans.submit({ resources: [1] as any });
    expect(plan.id).toBe(PLAN_ID);
  });

  it("getStatus() returns the plan state", async () => {
    server.use(
      http.get(`${BASE}/plans/p1/state`, () => HttpResponse.json({ item: { state: "optimized" } }))
    );
    const state = await client().routing.plans.getStatus("p1");
    expect(state).toBe("optimized");
  });

  it("list() sends pagination params and parses paging", async () => {
    let capturedUrl: URL | undefined;
    server.use(
      http.get(`${BASE}/plans`, ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json({
          items: [{ id: PLAN_ID }],
          paging: { total: 1, totalPages: 1, page: 1, itemsPerPage: 20, nextPage: null, previousPage: null },
        });
      })
    );
    const page = await client().routing.plans.list();
    expect(capturedUrl?.searchParams.get("page")).toBe("1");
    expect(capturedUrl?.searchParams.get("itemsPerPage")).toBe("20");
    expect(capturedUrl?.searchParams.get("archived")).toBe("excluded");
    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe(PLAN_ID);
  });

  it("iterAll() stops on the last page, where the API omits nextPage", async () => {
    // Observed live: with no next page, `paging` has no `nextPage` at all
    // (openapi.yaml: "absent on the last page"). iterAll() looped forever.
    const pages: Record<string, unknown> = {
      "1": { items: [{ id: "p1" }], paging: { total: 2, totalPages: 2, page: 1, itemsPerPage: 1, nextPage: 2 } },
      "2": { items: [{ id: "p2" }], paging: { total: 2, totalPages: 2, page: 2, itemsPerPage: 1, previousPage: 1 } },
    };
    let calls = 0;
    server.use(
      http.get(`${BASE}/plans`, ({ request }) => {
        calls += 1;
        return HttpResponse.json(pages[new URL(request.url).searchParams.get("page")!]);
      })
    );
    const ids: string[] = [];
    for await (const plan of client().routing.plans.iterAll()) ids.push(plan.id!);
    expect(ids).toEqual(["p1", "p2"]);
    expect(calls).toBe(2);
  });

  it("list() reports nextPage as null on the last page", async () => {
    server.use(
      http.get(`${BASE}/plans`, () =>
        HttpResponse.json({ items: [], paging: { total: 0, totalPages: 1, page: 1, itemsPerPage: 20 } })
      )
    );
    expect((await client().routing.plans.list()).nextPage).toBeNull();
  });

  it("404 raises KardinalNotFoundError with the right attributes", async () => {
    server.use(
      http.get(`${BASE}/plans/missing`, () =>
        HttpResponse.json({ errors: [{ code: "NOT_FOUND", message: "not found" }] }, { status: 404 })
      )
    );
    await expect(client().routing.plans.get("missing")).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(KardinalNotFoundError);
      const err = e as KardinalNotFoundError;
      expect(err.code).toBe("NOT_FOUND");
      expect(err.status).toBe(404);
      expect(err.retryable).toBe(false);
      return true;
    });
  });

  it("start/stop send a boolean body", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.put(`${BASE}/plans/p1/running`, async ({ request }) => {
        bodies.push(await request.json());
        return new HttpResponse(null, { status: 200 });
      })
    );
    const plans = client().routing.plans;
    await plans.start("p1");
    await plans.stop("p1");
    expect(bodies).toEqual([true, false]);
  });

  it("network failure raises KardinalConnectionError, not a raw fetch error", async () => {
    server.use(http.get(`${BASE}/plans/p1`, () => HttpResponse.error()));
    const noRetryClient = new Kardinal({ apiKey: "test-key", maxRetries: 0 });
    await expect(noRetryClient.routing.plans.get("p1")).rejects.toBeInstanceOf(KardinalConnectionError);
  });

  it("update() strips read-only fields from the request body", async () => {
    let sentBody: any;
    server.use(
      http.put(`${BASE}/plans/${PLAN_ID}`, async ({ request }) => {
        sentBody = await request.json();
        return HttpResponse.json({ item: { id: PLAN_ID, resources: [] } });
      })
    );
    const plan = {
      id: PLAN_ID,
      resources: [],
      agencyId: "BLD1234567_production",
      version: 3,
      running: false,
      nbResources: 0,
      createdAt: "2026-01-01T00:00:00Z",
    } as any;
    await client().routing.plans.update(plan);
    // `id` is readOnly in the spec: it only travels in the URL.
    expect(Object.keys(sentBody).sort()).toEqual(["resources"]);
  });
});
