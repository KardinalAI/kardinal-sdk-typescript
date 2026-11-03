import { expect, it } from "vitest";
import { typecheck } from "./typecheck.js";

const PREAMBLE = `import { examples } from "@kardinal-ai/sdk";\nconst p = examples.smallDeliveryPlan();\n`;

it("reports a type mismatch (negative control: proves the helper is wired)", () => {
  const diagnostics = typecheck({ "bad.ts": `${PREAMBLE}const n: number = p.tz;\n` });
  expect(diagnostics.length).toBeGreaterThan(0);
  expect(diagnostics.join("\n")).toMatch(/bad\.ts:3.*not assignable to type 'number'/);
});

it("reports nothing for a valid snippet", () => {
  expect(typecheck({ "good.ts": `${PREAMBLE}const t: string | undefined = p.tz;\nexport { t };\n` })).toEqual([]);
});

it("reports diagnostics per file when several files are compiled in one call", () => {
  const diagnostics = typecheck({
    "a.ts": `${PREAMBLE}export const ok: string | undefined = p.tz;\n`,
    "b.ts": `${PREAMBLE}export const n: number = p.tz;\n`,
  });
  expect(diagnostics.length).toBeGreaterThan(0);
  expect(diagnostics.every((line) => line.startsWith("b.ts:"))).toBe(true);
});

// A plan you submit leaves out every field that has a default. The generated
// `Resource` type makes `priority` mandatory, so the input type has to say
// that it is optional while the output type keeps it.
const RESOURCE_HEAD = `import type { PlanCreate, PlanCreateInput } from "@kardinal-ai/sdk";
const resource = {
  id: "truck",
  vehicleProfile: { type: "truck" },
  workingTimeWindow: { begin: "2026-08-03 08:00", end: "2026-08-03 18:00" },
} as const;
`;

it("a resource without priority is a valid PlanCreateInput", () => {
  const good = `${RESOURCE_HEAD}export const plan: PlanCreateInput = { resources: [resource] };\n`;
  expect(typecheck({ "good.ts": good })).toEqual([]);
});

it("a misspelled resource key is still refused in a PlanCreateInput", () => {
  const bad = `${RESOURCE_HEAD}export const plan: PlanCreateInput = { resources: [{ ...resource, preferedStopTags: ["a"] }] };\n`;
  expect(typecheck({ "bad.ts": bad }).join("\n")).toMatch(/bad\.ts:\d+ .*preferedStopTags/);
});

it("a resource without priority is still refused in a PlanCreate (the output type)", () => {
  const bad = `${RESOURCE_HEAD}export const plan: PlanCreate = { resources: [resource], lateDeparture: false, sharedCapacities: false };\n`;
  expect(typecheck({ "bad.ts": bad }).join("\n")).toMatch(/bad\.ts:\d+ .*priority/);
});

it("parsePlanCreate turns a case-study plan into fully typed resources", () => {
  const good = `import { examples, parsePlanCreate } from "@kardinal-ai/sdk";
import type { Resource } from "@kardinal-ai/sdk";
export const rs: Resource[] = parsePlanCreate(examples.coldChainPlan()).resources;
`;
  expect(typecheck({ "good.ts": good })).toEqual([]);
});
