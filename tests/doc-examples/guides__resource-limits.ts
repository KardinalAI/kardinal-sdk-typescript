// Copied from guides/resource-limits.mdx by scripts/sync-doc-examples.mjs: do not edit by hand.

// --- guides/resource-limits.mdx:271
import type { PlanCreateInput } from "@kardinal-ai/sdk";

const depot = { lon: 2.35, lat: 48.85 };

function delivery(number: number, stopId: string, lon: number) {
  return {
    id: `order-${number}`,
    priority: 0,
    stops: [
      {
        type: "single" as const,
        id: stopId,
        kind: "delivery" as const,
        position: { lon, lat: 48.85 },
        operationDuration: "PT30M",
      },
    ],
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
      workingTimeWindow: { begin: "2026-11-04 08:00", end: "2026-11-04 17:00" },
      departure: depot,
      arrival: depot,
      maxWorkingDuration: "PT3H",
    },
  ],
  orders: [
    delivery(1, "stop-1", 2.377),
    delivery(2, "stop-2", 2.391),
    delivery(3, "stop-3", 2.405),
    delivery(4, "stop-far", 2.9),
  ],
};


// --- guides/resource-limits.mdx:377
const DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

// Turn an ISO 8601 duration such as PT1H39M40S into seconds.
function seconds(duration: string): number {
  const [days, hours, minutes, secs] = DURATION.exec(duration)!.slice(1).map((part) => Number(part ?? 0));
  return ((days * 24 + hours) * 60 + minutes) * 60 + secs;
}

// Return the limits that the tour is over.
function checkLimits(
  tour: { workingDuration: string; distanceInKm: number },
  resource: { maxWorkingDuration?: string; maxDistanceInKm?: number },
): string[] {
  const problems: string[] = [];
  const cap = resource.maxWorkingDuration;
  if (cap && seconds(tour.workingDuration) > seconds(cap)) {
    problems.push(`workingDuration ${tour.workingDuration} is over ${cap}`);
  }
  const limit = resource.maxDistanceInKm;
  if (limit && tour.distanceInKm > limit) {
    problems.push(`distanceInKm ${tour.distanceInKm} is over ${limit}`);
  }
  return problems;
}
