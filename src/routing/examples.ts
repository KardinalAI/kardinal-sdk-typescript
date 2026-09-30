/**
 * Ready-to-submit example plans. Written by hand as code (not loaded from
 * a JSON fixture) so that reading the example is the first lesson in
 * modelling this API — a function, not a module constant, so every call
 * returns a fresh object the caller can modify freely.
 */

import type { PlanCreate } from "./schemas.js";
import type { Resource } from "./types.js";

// Fixed +01:00, not a real IANA timezone library: the exact DST offset
// doesn't matter for a demo working window with hours of margin either
// way, and this keeps the example dependency-free.
const DEMO_UTC_OFFSET = "+01:00";
const DEMO_UTC_OFFSET_MS = 60 * 60 * 1000;

// Depot and eight delivery addresses around central Paris.
const DEPOT = { lat: 48.8566, lon: 2.3522 };
const ADDRESSES = [
  { lat: 48.8738, lon: 2.295 }, // Arc de Triomphe
  { lat: 48.8606, lon: 2.3376 }, // Louvre
  { lat: 48.8462, lon: 2.3372 }, // Montparnasse
  { lat: 48.8867, lon: 2.3431 }, // Montmartre
  { lat: 48.8534, lon: 2.3488 }, // Notre-Dame
  { lat: 48.8656, lon: 2.3212 }, // Champs-Élysées
  { lat: 48.8417, lon: 2.3324 }, // Denfert-Rochereau
  { lat: 48.8799, lon: 2.355 }, // Gare du Nord
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Computed fresh on every call, not a fixed calendar date: this example is
 * meant to stay submittable indefinitely, and a resource whose
 * workingTimeWindow is already in the past isn't a meaningful plan to
 * optimize.
 */
function tomorrowsWorkingWindow(): { begin: string; end: string } {
  // Shifted by the offset, so the UTC getters below read the +01:00 date.
  const tomorrow = new Date(Date.now() + DEMO_UTC_OFFSET_MS + 24 * 60 * 60 * 1000);
  const y = tomorrow.getUTCFullYear();
  const m = pad(tomorrow.getUTCMonth() + 1);
  const d = pad(tomorrow.getUTCDate());
  return {
    begin: `${y}-${m}-${d}T08:00:00${DEMO_UTC_OFFSET}`,
    end: `${y}-${m}-${d}T18:00:00${DEMO_UTC_OFFSET}`,
  };
}

/**
 * Two resources, eight stops, a ten-second optimization budget — enough to
 * pose a real routing decision, small enough to return quickly and cost
 * only a few credits. Copy and adapt this rather than building a plan from
 * scratch.
 */
export function smallDeliveryPlan(): PlanCreate {
  const workingTimeWindow = tomorrowsWorkingWindow();

  const resources: Resource[] = [1, 2].map((i) => ({
    id: `truck-${i}`,
    priority: 0,
    vehicleProfile: { type: "car" },
    departure: DEPOT,
    workingTimeWindow,
    capacities: { packages: 20 },
  }));

  const orders = ADDRESSES.map((position, i) => ({
    id: `order-${i + 1}`,
    priority: 0,
    stops: [
      {
        type: "single" as const,
        id: `stop-${i + 1}`,
        position,
        operationDuration: "PT5M",
        capacities: { packages: 1 },
      },
    ],
  }));

  return {
    tz: "Europe/Paris",
    maxOptimizationDuration: "PT10S",
    resources,
    orders,
    lateDeparture: false,
    sharedCapacities: false,
  };
}
