import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parsePlanCreate, orderSchema } from "../src/routing/schemas.js";

describe("parsePlanCreate", () => {
  it("rejects an empty plan (missing resources)", () => {
    expect(() => parsePlanCreate({})).toThrow(z.ZodError);
  });

  it("rejects an unknown field (strict mode)", () => {
    expect(() => parsePlanCreate({ resources: [{ id: "r1" }], bogusField: 123 })).toThrow();
  });

  it("rejects a client-supplied id, like the real Builder API would", () => {
    // PlanCreate has no `id` field at all — strict() rejects it as unknown.
    expect(() => parsePlanCreate({ id: "should-not-exist", resources: [{ id: "r1" }] })).toThrow();
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
