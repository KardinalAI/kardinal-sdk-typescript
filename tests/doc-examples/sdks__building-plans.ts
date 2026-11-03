// Copied from sdks/building-plans.mdx by scripts/sync-doc-examples.mjs: do not edit by hand.

// --- sdks/building-plans.mdx:56
import { examples } from "@kardinal-ai/sdk";

const plan = examples.smallDeliveryPlan();
plan.orders = [
  ...(plan.orders ?? []),
  {
    id: "order-9",
    priority: 0,
    stops: [
      {
        type: "single",
        id: "stop-9",
        position: { lat: 48.8584, lon: 2.2945 },
        operationDuration: "PT5M",
      },
    ],
  },
];


// --- sdks/building-plans.mdx:97
import { readFileSync } from "node:fs";
import { Kardinal, parsePlanCreate } from "@kardinal-ai/sdk";

const plan = parsePlanCreate(JSON.parse(readFileSync("plan.json", "utf8")));
const created = await new Kardinal().routing.plans.submit(plan);


// --- sdks/building-plans.mdx:126
import { unknownFields } from "@kardinal-ai/sdk";

for (const field of unknownFields(plan)) {
  console.log(field); // plan.resources[0].maxWorkingDurationn, with the closest field name
}
