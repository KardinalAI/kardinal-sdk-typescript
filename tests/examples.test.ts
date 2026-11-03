import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { coldChainPlan, smallDeliveryPlan } from "../src/routing/examples.js";
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

// The copies of the published "Full payload" blocks, refreshed by
// `npm run sync:doc-examples`. Their dates are 2026-08-03, which is tomorrow
// at +01:00 when the clock says 2026-08-02 noon.
function published(slug: string): unknown {
  return JSON.parse(readFileSync(new URL(`./case-studies/${slug}.json`, import.meta.url), "utf-8"));
}

function withClockAt<T>(now: string, run: () => T): T {
  vi.useFakeTimers({ now: new Date(now) });
  try {
    return run();
  } finally {
    vi.useRealTimers();
  }
}

describe("coldChainPlan", () => {
  it("is the published payload of the cold-chain case study, key for key", () => {
    const plan = withClockAt("2026-08-02T12:00:00Z", coldChainPlan);
    expect(plan).toStrictEqual(published("cold-chain-last-mile"));
  });

  it("passes local validation with no unknown field allowed", () => {
    expect(() => parsePlanCreate(coldChainPlan())).not.toThrow();
  });

  it("returns a fresh object on every call", () => {
    const a = coldChainPlan();
    const b = coldChainPlan();
    expect(a).not.toBe(b);
    expect(a.resources).not.toBe(b.resources);
    expect(a.orders).not.toBe(b.orders);
  });

  it("has 15 stops, one credit each in production", () => {
    const stops = coldChainPlan().orders!.flatMap((order) => order.stops);
    expect(stops).toHaveLength(15);
  });

  it("reads the clock once, so a plan built across midnight keeps one date", () => {
    // 22:59:59.999 UTC is 23:59:59.999 at +01:00: the next call to Date.now()
    // would already be in the day after.
    vi.useFakeTimers({ now: new Date("2026-08-02T22:59:59.999Z") });
    try {
      const nowSpy = vi.spyOn(Date, "now");
      const plan = coldChainPlan();
      expect(nowSpy).toHaveBeenCalledTimes(1);
      const dates = new Set(JSON.stringify(plan).match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g)!.map((t) => t.slice(0, 10)));
      expect([...dates]).toEqual(["2026-08-03"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
