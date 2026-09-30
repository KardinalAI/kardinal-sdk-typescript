import { describe, expect, it } from "vitest";
import { smallDeliveryPlan } from "../src/routing/examples.js";
import { parsePlanCreate } from "../src/routing/schemas.js";

describe("smallDeliveryPlan", () => {
  it("produces a plan that passes local validation", () => {
    const plan = parsePlanCreate(smallDeliveryPlan());
    expect(plan.resources).toHaveLength(2);
    expect(plan.orders).toHaveLength(8);
  });

  it("computes a working window that is always in the future, not a fixed stale date", () => {
    const plan = smallDeliveryPlan();
    const begin = new Date((plan.resources[0] as any).workingTimeWindow.begin);
    expect(begin.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns a fresh object on every call (no shared mutable state)", () => {
    const a = smallDeliveryPlan();
    const b = smallDeliveryPlan();
    expect(a).not.toBe(b);
    expect(a.resources).not.toBe(b.resources);
  });
});
