// Copied from guides/capacities.mdx by scripts/sync-doc-examples.mjs: do not edit by hand.

// --- guides/capacities.mdx:386
import type { PlanCreateInput } from "@kardinal-ai/sdk";

const depot = { lon: 2.35, lat: 48.85 };
const deliveryWindow = [{ begin: "2026-11-03 09:00", end: "2026-11-03 12:00" }];

function delivery(number: number, lon: number) {
  return {
    id: `order-${number}`,
    priority: 0,
    stops: [
      {
        type: "single" as const,
        id: `delivery-${number}`,
        kind: "delivery" as const,
        position: { lon, lat: 48.85 },
        operationDuration: "PT10M",
        capacities: { weight: 200, nbDeliveries: 1 },
        authorizedTimeWindows: deliveryWindow,
      },
    ],
  };
}

const plan: PlanCreateInput = {
  tz: "Europe/Paris",
  maxOptimizationDuration: "PT5S",
  resources: [
    {
      id: "truck-1",
      priority: 0,
      vehicleProfile: { type: "car" },
      workingTimeWindow: { begin: "2026-11-03 08:00", end: "2026-11-03 17:00" },
      departure: depot,
      arrival: depot,
      capacities: { weight: 1200, nbDeliveries: 30, nbPickups: 10 },
    },
  ],
  orders: [
    delivery(1, 2.377),
    delivery(2, 2.391),
    delivery(3, 2.405),
    {
      id: "order-4",
      priority: 0,
      stops: [
        {
          type: "single",
          id: "pickup-1",
          kind: "pickup",
          position: { lon: 2.364, lat: 48.85 },
          operationDuration: "PT10M",
          capacities: { weight: 60, nbPickups: 1 },
          authorizedTimeWindows: [{ begin: "2026-11-03 08:00", end: "2026-11-03 12:00" }],
        },
      ],
    },
  ],
  additionalConstraints: [
    {
      type: "atLeastOneValidCapacity",
      name: "pickups-late",
      capacities: { nbDeliveries: 0, nbPickups: 0, weight: 300 },
    },
  ],
};
