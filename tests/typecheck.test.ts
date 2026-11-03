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
