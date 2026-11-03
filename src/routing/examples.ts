/**
 * Ready-to-submit example plans. Written by hand as code (not loaded from
 * a JSON fixture) so that reading the example is the first lesson in
 * modelling this API — a function, not a module constant, so every call
 * returns a fresh object the caller can modify freely.
 */

import type { components } from "./generated-types.js";
import type { PlanCreate, PlanCreateInput } from "./schemas.js";
import type { Resource } from "./types.js";

type Schemas = components["schemas"];

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
 * The payloads write local wall-clock times, "YYYY-MM-DD HH:MM", read in the
 * plan's `tz`. The day is read once, so a plan built across midnight never
 * mixes two dates.
 */
function atTomorrow(): (hhmm: string) => string {
  const tomorrow = new Date(Date.now() + DEMO_UTC_OFFSET_MS + 24 * 60 * 60 * 1000);
  const day = `${tomorrow.getUTCFullYear()}-${pad(tomorrow.getUTCMonth() + 1)}-${pad(tomorrow.getUTCDate())}`;
  return (hhmm) => `${day} ${hhmm}`;
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

/**
 * The plan of the cold-chain last-mile case study, built field by field:
 * https://developers.kardinal.ai/case-studies/cold-chain-last-mile
 *
 * One bi-temperature truck driver plus two extra drivers deliver ambient,
 * chilled and frozen goods in Paris, from one depot. Dates move to tomorrow.
 *
 * Submitting it as is:
 *
 * - with a production key costs one credit per stop, so 15 credits here;
 * - leaves `maxOptimizationDuration` unset, so production optimizes for up to
 *   15 minutes and stops earlier once the result stops improving;
 * - in the sandbox is free, and the answer carries warnings that traffic is
 *   ignored and that routes are computed as the crow flies.
 */
export function coldChainPlan(): PlanCreateInput {
  const at = atTomorrow();
  const depot = { lon: 2.295, lat: 48.872 };
  // Driver tags: `driver` counts toward the one-driver-per-key-set limit,
  // `bi-temperature` selects the ambient/frozen compartment constraint.
  const driverTags = ["driver", "bi-temperature"];

  const resources: PlanCreateInput["resources"] = [
    // Truck with a worked-hours cost, a break rule and a preferred sector.
    {
      id: "truck-1",
      vehicleProfile: { type: "truck", withTraffic: true },
      workingTimeWindow: { begin: at("05:00"), end: at("20:00") },
      departure: depot,
      arrival: depot,
      capacities: { weight: 1200, pallets: 12, ambiant: 400, frozen: 250 },
      preferredStopTags: ["zone:usual-sector-7"],
      tags: driverTags,
      breaks: [{ type: "workingDurationSlidingBreak", minBreakDuration: "PT30M", maxInterBreakDuration: "PT6H" }],
      maxWorkingDuration: "PT9H",
      cost: { workedHours: { costFloor: 8, costCoeff: 1, overcostFloor: 10, overcostCoeff: 1.25 } },
    },
    // Two drivers with the two compartments only, on a shorter day.
    ...[1, 2].map((i) => ({
      id: `driver-${i}`,
      vehicleProfile: { type: "truck" as const },
      workingTimeWindow: { begin: at("07:00"), end: at("17:00") },
      departure: depot,
      arrival: depot,
      capacities: { ambiant: 400, frozen: 250 },
      tags: driverTags,
    })),
  ];

  // Every temperature-controlled or pallet delivery starts at the depot.
  const pickup = (id: string, capacities: Record<string, number>) => ({
    type: "single" as const,
    id,
    position: depot,
    kind: "pickup" as const,
    operationDuration: "PT5M",
    capacities,
  });

  // Compartments: each order loads the capacity named for its own
  // temperature need, in the pickup and the delivery alike.
  const orders: NonNullable<PlanCreateInput["orders"]> = [
    { name: "ambient", capacity: "ambiant", quantity: 40, lon: 2.31, lat: 48.882 },
    { name: "chilled", capacity: "frozen", quantity: 30, lon: 2.275, lat: 48.88 },
    { name: "frozen", capacity: "frozen", quantity: 20, lon: 2.305, lat: 48.854 },
  ].map(({ name, capacity, quantity, lon, lat }) => ({
    id: `order-${name}`,
    stops: [
      pickup(`stop-pickup-${name}`, { [capacity]: quantity }),
      {
        type: "single" as const,
        id: `stop-${name}`,
        position: { lon, lat },
        kind: "delivery" as const,
        operationDuration: "PT6M",
        capacities: { [capacity]: quantity },
      },
    ],
  }));

  // Afternoon pallets: the first one has a window and a preferred slot, in
  // the truck's preferred sector; the third is outside it, in an overflow zone.
  [
    { lon: 2.32, lat: 48.867, zone: "zone:usual-sector-7" },
    { lon: 2.265, lat: 48.887, zone: "zone:usual-sector-7" },
    { lon: 2.3, lat: 48.894, zone: "zone:overflow" },
  ].forEach(({ lon, lat, zone }, i) => {
    orders.push({
      id: `order-afternoon-${i}`,
      stops: [
        pickup(`stop-pickup-afternoon-${i}`, { pallets: 1 }),
        {
          type: "single" as const,
          id: `stop-afternoon-${i}`,
          position: { lon, lat },
          kind: "delivery" as const,
          operationDuration: "PT8M",
          capacities: { pallets: 1 },
          tags: [zone],
          ...(i === 0 && {
            authorizedTimeWindows: [{ begin: at("08:00"), end: at("18:00") }],
            preferredTimeWindows: [{ begin: at("14:00"), end: at("16:00") }],
          }),
        },
      ],
    });
  });

  // Keychain: three early deliveries share one set of keys, which only one
  // driver may hold (see the global constraint below).
  [
    { lon: 2.31, lat: 48.882 },
    { lon: 2.275, lat: 48.88 },
    { lon: 2.305, lat: 48.854 },
  ].forEach((position, i) => {
    orders.push({
      id: `order-keychain-${i}`,
      stops: [
        {
          type: "single" as const,
          id: `stop-keychain-${i}`,
          position,
          kind: "delivery" as const,
          operationDuration: "PT5M",
          tags: ["keychain:trusted-set-1"],
          authorizedTimeWindows: [{ begin: at("06:30"), end: at("08:00") }],
        },
      ],
    });
  });

  return {
    tz: "Europe/Paris",
    resources,
    orders,
    objectives: [
      "maximizeMandatoryStops",
      "minimizeResources",
      "minimizeLargestTourDuration",
      "minimizeCosts",
      "maximizePreferredStops",
      "minimizeDelay",
      "minimizeWorkingDuration",
      "minimizeDistance",
    ] satisfies Schemas["ObjectivesEnum"][],
    additionalConstraints: [
      // A bi-temperature vehicle carries ambient or frozen goods at a time,
      // never both: one of the two loads must be 0.
      {
        type: "atLeastOneValidCapacity",
        capacities: { frozen: 0, ambiant: 0 },
        name: "bi-temperature-single-mode-at-a-time",
        resourceTags: ["bi-temperature"],
      },
    ] satisfies Schemas["AdditionalConstraintAtLeastOneValidCapacity"][],
    globalConstraints: [
      // One driver per key set: each driver is charged for the keychain stops
      // it serves, and the cap keeps that to one driver.
      {
        type: "maxCumulatedCost",
        maximum: 1,
        costsByResourceTag: {
          driver: {
            costsByStopTag: {
              "keychain:trusted-set-1": { costFloor: 0, costCoeff: 1, overcostFloor: 1, overcostCoeff: 0 },
            },
          },
        },
        name: "one-driver-per-key-set",
      },
    ] satisfies Schemas["GlobalConstraintMaxCumulatedCost"][],
  };
}
