/**
 * Most plan fields are optional, so a misspelled one used to be removed in
 * silence — by this SDK, then by the API, which drops any key it doesn't
 * know. The field it was meant to set stayed unset and the plan came back
 * valid. `submit()` now refuses such a key; `update()` tells one the server
 * sent from one the caller added, which is the same split the Python SDK
 * makes.
 */
import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./setup.js";
import { Kardinal, UnknownFieldError } from "../src/index.js";

const BASE = "https://app.kardinal.ai/api/v2";
const PLAN_ID = "4cbd0ab8-282c-4b30-b981-29e1ed8a2016";
const TW = { begin: "2026-10-08T08:00:00Z", end: "2026-10-08T18:00:00Z" };
const RESOURCE = { id: "r1", vehicleProfile: { type: "car" as const }, workingTimeWindow: TW };

function client() {
  return new Kardinal({ apiKey: "test-key" });
}

/** Serves `resources` on GET, and records what a PUT sent. */
function serving(resources: unknown[]) {
  const state: { sent?: any } = {};
  const item = { id: PLAN_ID, resources };
  server.use(
    http.get(`${BASE}/plans/${PLAN_ID}`, () => HttpResponse.json({ item })),
    http.put(`${BASE}/plans/${PLAN_ID}`, async ({ request }) => {
      state.sent = await request.json();
      return HttpResponse.json({ item });
    }),
    http.post(`${BASE}/plans`, async ({ request }) => {
      state.sent = await request.json();
      return HttpResponse.json({ item }, { status: 201 });
    }),
  );
  return state;
}

describe("submit()", () => {
  it("refuses a misspelled field, naming it and what it was probably meant to be", async () => {
    serving([]);
    const promise = client().routing.plans.submit({
      resources: [{ ...RESOURCE, maxWorkingDurationn: "PT8H" } as any],
    });
    await expect(promise).rejects.toBeInstanceOf(UnknownFieldError);
    await promise.catch((e: UnknownFieldError) => {
      expect(e.paths).toEqual(["plan.resources[0].maxWorkingDurationn"]);
      expect(e.message).toContain("did you mean maxWorkingDuration?");
    });
  });

  it("sends a field named in allowUnknown, and still refuses the rest", async () => {
    const state = serving([]);
    await client().routing.plans.submit(
      { resources: [{ ...RESOURCE, aNewApiField: "x" } as any] },
      { allowUnknown: ["aNewApiField"] },
    );
    expect(state.sent.resources[0].aNewApiField).toBe("x");

    const promise = client().routing.plans.submit(
      { resources: [{ ...RESOURCE, aNewApiField: "x", maxWorkingDurationn: "PT8H" } as any] },
      { allowUnknown: ["aNewApiField"] },
    );
    await expect(promise).rejects.toMatchObject({ paths: ["plan.resources[0].maxWorkingDurationn"] });
  });
});

describe("update()", () => {
  it("sends back a field the API added, untouched", async () => {
    const state = serving([{ ...RESOURCE, modeAddedByApi: "standard" }]);
    const plans = client().routing.plans;
    await plans.update(await plans.get(PLAN_ID));
    expect(state.sent.resources[0].modeAddedByApi).toBe("standard");
  });

  it("refuses a key the caller added", async () => {
    serving([{ ...RESOURCE, modeAddedByApi: "standard" }]);
    const plans = client().routing.plans;
    const plan = await plans.get(PLAN_ID);
    (plan.resources[0] as any).maxWorkingDurationn = "PT8H";
    await expect(plans.update(plan)).rejects.toMatchObject({
      paths: ["plan.resources[0].maxWorkingDurationn"],
    });
  });

  it("recognises the API field on a resource added afterwards", async () => {
    // Provenance ignores the index: a field the API added carries the same
    // name on every object of that kind, while `resources[3]` moves as soon
    // as the caller reorders or drops one.
    const state = serving([{ ...RESOURCE, modeAddedByApi: "standard" }]);
    const plans = client().routing.plans;
    const plan = await plans.get(PLAN_ID);
    plan.resources.push({ ...RESOURCE, id: "r2", modeAddedByApi: "x" } as any);
    await plans.update(plan);
    expect(state.sent.resources).toHaveLength(2);
  });

  it("is not a false alarm when resources are reordered", async () => {
    serving([{ ...RESOURCE, modeAddedByApi: "s" }, { ...RESOURCE, id: "r2" }]);
    const plans = client().routing.plans;
    const plan = await plans.get(PLAN_ID);
    plan.resources.reverse();
    await expect(plans.update(plan)).resolves.toBeDefined();
  });

  it("warns, never refuses, on a plan this SDK never read", async () => {
    // Nothing to sort by, so resemblance is all that's left. Refusing would
    // break the day the API adds a field, on a plan it cannot vouch for.
    const state = serving([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rebuilt = JSON.parse(
      JSON.stringify({
        id: PLAN_ID,
        resources: [{ ...RESOURCE, maxWorkingDurationn: "PT8H" }],
        warnings: [],
      }),
    );
    await client().routing.plans.update(rebuilt);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("maxWorkingDuration");
    expect(state.sent.resources[0].maxWorkingDurationn).toBe("PT8H");
    warn.mockRestore();
  });

  it("says nothing about an unrecognisable key on such a plan", async () => {
    serving([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await client().routing.plans.update(
      JSON.parse(
        JSON.stringify({
          id: PLAN_ID,
          resources: [{ ...RESOURCE, somethingEntirelyNew: 1 }],
          warnings: [],
        }),
      ),
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
