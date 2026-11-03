// Copied from sdks/plan-lifecycle.mdx by scripts/sync-doc-examples.mjs: do not edit by hand.

// --- sdks/plan-lifecycle.mdx:23
import { Kardinal, examples } from "@kardinal-ai/sdk";

const k = new Kardinal();
const plan = await k.routing.plans.submit(examples.smallDeliveryPlan());
console.log(plan.id, plan.version);
for (const warning of plan.warnings) {
  console.log(warning.code, warning.properties);
}


// --- sdks/plan-lifecycle.mdx:50
let solution = await k.routing.solutions.wait(plan.id); // no time limit
solution = await k.routing.solutions.wait(plan.id, 600_000); // at most 10 minutes
console.log(solution.finalState);


// --- sdks/plan-lifecycle.mdx:78
const state = await k.routing.plans.getStatus(plan.id); // waiting, processing, optimizing, optimized, ...
if (state === "optimized") {
  const solution = await k.routing.solutions.get(plan.id);
}
const objectives = await k.routing.solutions.getObjectives(plan.id); // objective values only


// --- sdks/plan-lifecycle.mdx:128
let current = await k.routing.plans.get(plan.id);
current.orders = [
  ...(current.orders ?? []),
  { id: "order-10", priority: 0, stops: [{ type: "single", id: "stop-10", position: { lat: 48.86, lon: 2.35 } }] },
];
current = await k.routing.plans.update(current); // same id, new version
const updated = await k.routing.solutions.wait(current.id);


// --- sdks/plan-lifecycle.mdx:154
await k.routing.plans.stop(plan.id); // stop the optimization in progress
await k.routing.plans.start(plan.id); // restart it, on the same version


// --- sdks/plan-lifecycle.mdx:175
const page = await k.routing.plans.list({ page: 1, itemsPerPage: 20 });
console.log(page.total, page.totalPages, page.nextPage);

for await (const lightPlan of k.routing.plans.iterAll()) {
  // every page, one plan at a time
  console.log(lightPlan.id, lightPlan.state);
}


// --- sdks/plan-lifecycle.mdx:197
await k.routing.plans.delete(plan.id);
