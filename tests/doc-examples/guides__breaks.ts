// Copied from guides/breaks.mdx by scripts/sync-doc-examples.mjs: do not edit by hand.

// --- guides/breaks.mdx:238
import type { PlanCreateInput } from "@kardinal-ai/sdk";

const depot = { lon: 2.35, lat: 48.85 };

const plan: PlanCreateInput = {
  tz: "Europe/Paris",
  maxOptimizationDuration: "PT5S",
  resources: [
    {
      id: "van-1",
      priority: 0,
      vehicleProfile: { type: "car" },
      workingTimeWindow: { begin: "2026-10-29 08:00", end: "2026-10-29 20:00" },
      departure: depot,
      arrival: depot,
      breaks: [
        {
          type: "timeWindowBreak",
          duration: "PT45M",
          timeWindow: { begin: "2026-10-29 12:00", end: "2026-10-29 14:00" },
        },
      ],
    },
  ],
  orders: [
    {
      id: "order-morning",
      priority: 0,
      stops: [
        {
          type: "single",
          id: "stop-morning",
          kind: "delivery",
          position: { lon: 2.36, lat: 48.855 },
          operationDuration: "PT10M",
        },
      ],
    },
    {
      id: "order-afternoon",
      priority: 0,
      stops: [
        {
          type: "single",
          id: "stop-afternoon",
          kind: "delivery",
          position: { lon: 2.34, lat: 48.845 },
          operationDuration: "PT10M",
          authorizedTimeWindows: [{ begin: "2026-10-29 15:00", end: "2026-10-29 16:00" }],
        },
      ],
    },
  ],
};
