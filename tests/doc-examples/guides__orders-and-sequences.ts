// Copied from guides/orders-and-sequences.mdx by scripts/sync-doc-examples.mjs: do not edit by hand.

// --- guides/orders-and-sequences.mdx:393
import type { PlanCreateInput } from "@kardinal-ai/sdk";

const depot = { lon: 2.35, lat: 48.85 };

function stop(id: string, kind: "pickup" | "delivery", lon: number) {
  return {
    type: "single" as const,
    id,
    kind,
    position: { lon, lat: 48.85 },
    operationDuration: "PT5M",
  };
}

const plan: PlanCreateInput = {
  tz: "Europe/Paris",
  maxOptimizationDuration: "PT5S",
  resources: [
    {
      id: "van-1",
      priority: 0,
      vehicleProfile: { type: "car" },
      workingTimeWindow: { begin: "2026-11-03 08:00", end: "2026-11-03 18:00" },
      departure: depot,
      arrival: depot,
    },
  ],
  orders: [
    {
      id: "order-1",
      priority: 0,
      successiveStops: true,
      stops: [stop("pickup-1", "pickup", 2.364), stop("delivery-1", "delivery", 2.487)],
    },
    {
      id: "order-2",
      priority: 0,
      successiveStops: true,
      stops: [stop("pickup-2", "pickup", 2.378), stop("delivery-2", "delivery", 2.501)],
    },
    {
      id: "order-3",
      priority: 0,
      stops: [
        stop("collect-3", "pickup", 2.309),
        {
          type: "alternatives",
          id: "drop-site",
          alternatives: [stop("drop-far", "delivery", 2.145), stop("drop-near", "delivery", 2.282)],
        },
      ],
    },
  ],
};


// --- guides/orders-and-sequences.mdx:521
import type { PlanCreateInput, WaitedSolution } from "@kardinal-ai/sdk";

export function checkOrders(plan: PlanCreateInput, solution: WaitedSolution): string[] {
  const served = new Set(
    (solution.tours ?? []).flatMap((tour) =>
      (tour.wayPoints ?? []).filter((w) => w.type === "stop").map((w) => w.stopId),
    ),
  );
  const leftOut = new Set(solution.unaffectedStopIds ?? []);

  // Map each candidate id to the id of its group.
  const groupOf = new Map<string, string>();
  for (const order of plan.orders ?? []) {
    for (const stop of order.stops) {
      if (stop.type !== "alternatives") continue;
      for (const candidate of stop.alternatives) groupOf.set(candidate.id, stop.id);
    }
  }
  const servedGroups = new Set([...served].map((id) => groupOf.get(id ?? "")));

  const problems: string[] = [];
  for (const order of plan.orders ?? []) {
    for (const stop of order.stops) {
      if (stop.type === "single" && leftOut.has(stop.id)) {
        problems.push(`${order.id}: ${stop.id} is left out`);
      }
      if (stop.type === "alternatives" && !servedGroups.has(stop.id)) {
        problems.push(`${order.id}: no candidate of ${stop.id} is in a tour`);
      }
    }
  }
  return problems;
}
