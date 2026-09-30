import { describe, expect, it, vi } from "vitest";
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

  it("picks tomorrow in the plan's +01:00 offset, not in UTC", () => {
    // 23:30 UTC is already 00:30 the next day at +01:00.
    vi.useFakeTimers({ now: new Date("2026-10-01T23:30:00Z") });
    try {
      const begin = (smallDeliveryPlan().resources[0] as any).workingTimeWindow.begin;
      expect(begin).toBe("2026-10-03T08:00:00+01:00");
    } finally {
      vi.useRealTimers();
    }
  });
});
