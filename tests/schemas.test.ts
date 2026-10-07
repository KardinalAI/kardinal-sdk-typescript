import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parsePlanCreate, orderSchema, unknownFields } from "../src/routing/schemas.js";

const stop = { type: "single" as const, id: "s1", position: { lat: 48.85, lon: 2.35 } };

describe("parsePlanCreate", () => {
  it("rejects an empty plan (missing resources)", () => {
    expect(() => parsePlanCreate({})).toThrow(z.ZodError);
  });

  it("reports an unknown field at the top level", () => {
    const found = unknownFields({ resources: [{ id: "r1" }], bogusField: 123 });
    expect(found.map((f) => f.path)).toEqual(["plan.bogusField"]);
  });

  it("reports a client-supplied id rather than letting it through", () => {
    // PlanCreate has no `id`: the server assigns one. Sending an `id` anyway
    // is not refused by the API — it answers 201 with a different id — so a
    // caller reusing the one they sent would address a plan that doesn't
    // exist. submit() refuses it instead.
    const found = unknownFields({ id: "should-not-exist", resources: [{ id: "r1" }] });
    expect(found.map((f) => f.path)).toEqual(["plan.id"]);
  });

  it("accepts a minimal valid plan", () => {
    const plan = parsePlanCreate({
      resources: [
        {
          id: "r1",
          vehicleProfile: { type: "car" },
          workingTimeWindow: { begin: "2026-10-01T08:00:00Z", end: "2026-10-01T18:00:00Z" },
        },
      ],
    });
    expect(plan.resources).toHaveLength(1);
    expect(plan.lateDeparture).toBe(false); // default applied
  });

  it("reports every problem, not just the first", () => {
    try {
      parsePlanCreate({ resources: "not-a-list" });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(z.ZodError);
    }
  });
});

describe("orderSchema (stops discriminator fix)", () => {
  it("keeps the `type` field on stops, unlike the generated Omit<Stop, 'type'>[] type", () => {
    const order = orderSchema.parse({
      id: "o1",
      priority: 0,
      stops: [{ type: "single", id: "s1", position: { lat: 48.85, lon: 2.35 } }],
    });
    expect(order.stops[0].type).toBe("single");
  });

  it("rejects a stop missing the required type discriminator", () => {
    expect(() =>
      orderSchema.parse({
        id: "o1",
        priority: 0,
        stops: [{ id: "s1", position: { lat: 48.85, lon: 2.35 } }],
      })
    ).toThrow(z.ZodError);
  });
});

describe("parsePlanCreate (rules shared with the Python SDK)", () => {
  const resource = {
    id: "r1",
    vehicleProfile: { type: "car" },
    workingTimeWindow: { begin: "2026-10-01T08:00:00Z", end: "2026-10-01T18:00:00Z" },
  };
  const order = (fields: Record<string, unknown>) => ({
    id: "o1",
    stops: [{ type: "single", id: "s1", position: { lat: 48.85, lon: 2.35 } }],
    ...fields,
  });

  it("accepts empty resources and stops, like openapi.yaml (no minItems)", () => {
    expect(() => parsePlanCreate({ resources: [], orders: [order({ stops: [] })] })).not.toThrow();
  });

  it("rejects an id outside the allowed characters", () => {
    expect(() => parsePlanCreate({ resources: [{ ...resource, id: "r 1" }] })).toThrow(z.ZodError);
    expect(() => parsePlanCreate({ resources: [], orders: [order({ id: "é" })] })).toThrow(z.ZodError);
  });

  it("rejects a malformed ISO 8601 duration", () => {
    expect(() => parsePlanCreate({ resources: [], maxOptimizationDuration: "10s" })).toThrow(z.ZodError);
    expect(() => parsePlanCreate({ resources: [], orders: [order({ maxStopSpan: "1h" })] })).toThrow(z.ZodError);
  });

  it("rejects a non-integer priority", () => {
    expect(() => parsePlanCreate({ resources: [], orders: [order({ priority: 1.5 })] })).toThrow(z.ZodError);
    expect(() => parsePlanCreate({ resources: [{ ...resource, priority: 0.5 }] })).toThrow(z.ZodError);
  });

  it("rejects an unknown vehicle profile type", () => {
    expect(() => parsePlanCreate({ resources: [{ ...resource, vehicleProfile: { type: "boat" } }] })).toThrow(
      z.ZodError
    );
  });

  it("keeps an unknown resource field so submit() can report it", () => {
    // Dropping it here is what made a misspelled optional field
    // undetectable: the plan was sent without it and came back valid.
    const plan = parsePlanCreate({ resources: [{ ...resource, bogus: 1 }] });
    expect(plan.resources[0]).toHaveProperty("bogus");
    expect(plan.resources[0].priority).toBe(0);
  });

  it("reports an unknown field at every level, with a suggestion", () => {
    const found = unknownFields({
      objectivs: {},
      resources: [{ ...resource, maxWorkingDurationn: "PT8H" }],
      orders: [
        { id: "o1", prioritty: 2, stops: [{ ...stop, operationDurationn: "PT5M" }] },
      ],
    });
    expect(found.map((f) => f.path).sort()).toEqual([
      "plan.objectivs",
      "plan.orders[0].prioritty",
      "plan.orders[0].stops[0].operationDurationn",
      "plan.resources[0].maxWorkingDurationn",
    ]);
    expect(found.find((f) => f.key === "maxWorkingDurationn")?.suggestion).toBe("maxWorkingDuration");
  });

  it("says nothing about a free-form map or a plausible future API field", () => {
    expect(
      unknownFields({
        resources: [{ ...resource, capacities: { anything: 3 }, properties: { free: "form" } }],
      }),
    ).toEqual([]);
    // Four edits from maxWorkingDuration: a field the API could add, not a slip.
    const future = unknownFields({ resources: [{ ...resource, maxDrivingDuration: "PT4H" }] });
    expect(future[0].suggestion).toBeUndefined();
  });
});
