// Copied from guides/skills-and-assignments.mdx by scripts/sync-doc-examples.mjs: do not edit by hand.

// --- guides/skills-and-assignments.mdx:215
import type { PlanCreateInput } from "@kardinal-ai/sdk";

function technician(id: string, lon: number, skills: string[]) {
  const home = { lon, lat: 48.85 };
  return {
    id,
    priority: 0,
    vehicleProfile: { type: "car" as const },
    workingTimeWindow: { begin: "2026-11-02 08:00", end: "2026-11-02 18:00" },
    departure: home,
    arrival: home,
    skills,
  };
}

function job(id: string, lon: number, lat: number, requiredSkills: string[]) {
  return {
    id: `order-${id}`,
    priority: 0,
    requiredSkills,
    stops: [
      {
        type: "single" as const,
        id: `stop-${id}`,
        kind: "delivery" as const,
        position: { lon, lat },
        operationDuration: "PT30M",
      },
    ],
  };
}

export const plan: PlanCreateInput = {
  tz: "Europe/Paris",
  maxOptimizationDuration: "PT5S",
  resources: [technician("tech-certified", 2.4, ["gas-certified"]), technician("tech-plain", 2.3, [])],
  orders: [
    job("boiler", 2.303, 48.85, ["gas-certified"]),
    job("meter", 2.403, 48.85, []),
    job("panel", 2.353, 48.86, ["electrical-certified"]),
  ],
};


// --- guides/skills-and-assignments.mdx:307
import type { WaitedSolution } from "@kardinal-ai/sdk";

export function check(solution: WaitedSolution): void {
  for (const stopId of solution.unaffectedStopIds ?? []) console.log(stopId, "was not planned");

  for (const tour of solution.tours ?? []) {
    console.log(tour.resourceId, tour.isValid ? "valid" : "NOT VALID");
    for (const violation of tour.violations ?? []) {
      if (violation.type === "skills") {
        console.log(" ", tour.resourceId, "lacks", violation.lackingSkills);
      } else if (violation.type === "forbiddenAssignment") {
        console.log(" ", tour.resourceId, "is barred by a forbiddenAssignment");
      }
    }
  }
}
