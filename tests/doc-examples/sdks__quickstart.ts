// Copied from sdks/quickstart.mdx by scripts/sync-doc-examples.mjs: do not edit by hand.

// --- sdks/quickstart.mdx:54
import { Kardinal, examples } from "@kardinal-ai/sdk";

const k = new Kardinal(); // reads KARDINAL_API_KEY
const plan = await k.routing.plans.submit(examples.smallDeliveryPlan());
const solution = await k.routing.solutions.wait(plan.id); // resolves in about 20 seconds


// --- sdks/quickstart.mdx:82
console.log(solution.finalState); // optimized, or interrupted/stopped if cut short
for (const tour of solution.tours ?? []) {
  // tours is absent when no stop could be planned
  console.log(tour.resourceId);
  for (const wp of tour.wayPoints ?? []) {
    if (wp.type === "stop") {
      console.log(wp.stopId, wp.arrivalTime, wp.beginTime);
    }
  }
}
console.log("Not planned:", solution.unaffectedStopIds ?? []);
