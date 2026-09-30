/**
 * Every ```ts block of the README, run in order as one module (as a reader
 * chaining the examples would) against a mocked API. A block added to the
 * README is run too, so a published example can't silently break.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./setup.js";

const BASE = "https://app.kardinal.ai/api/v2";
const PLAN_ID = "4cbd0ab8-282c-4b30-b981-29e1ed8a2016";
const PLAN_URL = `${BASE}/plans/${PLAN_ID}`;
const SDK_ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const CLAMPED = {
  code: "INVALID_VALUE",
  message: "The field value is not valid.",
  properties: { path: "maxOptimizationDuration", details: "clamped to 5s" },
};
const PLAN_SIZE_LIMIT = [
  {
    code: "INVALID_VALUE",
    message: "The field value is not valid.",
    properties: { path: "resources", details: "251 is greater than the allowed value (250)" },
  },
  {
    code: "NOT_ALLOWED",
    message: "The requested action is not allowed.",
    properties: { details: "The resulting plan violates the quotas configuration of the agency" },
  },
];

function tsBlocks(): string[] {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf-8");
  return [...readme.matchAll(/^```ts\n([\s\S]*?)^```/gm)].map((match) => match[1]);
}

/** The blocks as one module: imports hoisted and merged (type-only ones
 * dropped, the package pointed at the sources), and top-level `const`/`let`
 * turned into `var`, since the blocks redeclare names (`k`, `plan`, ...)
 * the way a reader re-running them would. */
function asModule(blocks: string[]): string {
  const names = new Set<string>();
  const body: string[] = [];
  for (const block of blocks) {
    for (const line of block.split("\n")) {
      const imported = /^import (type )?\{([^}]*)\} from "@kardinal-ai\/sdk";$/.exec(line);
      if (imported) {
        if (!imported[1]) for (const name of imported[2].split(",")) names.add(name.trim());
        continue;
      }
      expect(line, "a README import this test doesn't handle").not.toMatch(/^import /);
      body.push(line.replace(/^(const|let) /, "var "));
    }
  }
  return `import { ${[...names].join(", ")} } from ${JSON.stringify(SDK_ENTRY)};\n${body.join("\n")}\n`;
}

/** Echoes submitted plans back with an id and a version, like the API, and
 * reports every plan as optimized with a one-tour solution. */
function fakeApi() {
  const api = {
    plan: null as Record<string, any> | null,
    updated: null as Record<string, any> | null,
    rejectSubmit: false,
  };
  server.use(
    http.post(`${BASE}/plans`, async ({ request }) => {
      if (api.rejectSubmit) return HttpResponse.json({ errors: PLAN_SIZE_LIMIT }, { status: 403 });
      api.plan = { ...((await request.json()) as object), id: PLAN_ID, version: 1 };
      return HttpResponse.json({ item: api.plan, warnings: [CLAMPED] }, { status: 201 });
    }),
    http.put(PLAN_URL, async ({ request }) => {
      api.plan = { ...((await request.json()) as object), id: PLAN_ID, version: api.plan!.version + 1 };
      api.updated = api.plan;
      return HttpResponse.json({ item: api.plan });
    }),
    http.get(PLAN_URL, () => HttpResponse.json({ item: api.plan })),
    http.get(`${PLAN_URL}/state`, () =>
      HttpResponse.json({ item: { state: "optimized", planVersion: api.plan!.version } })
    ),
    http.get(`${PLAN_URL}/solution`, () =>
      HttpResponse.json({
        item: {
          planId: PLAN_ID,
          planVersion: api.plan!.version,
          tours: [{ resourceId: api.plan!.resources[0].id, wayPoints: [] }],
        },
      })
    ),
    http.get(`${PLAN_URL}/solution/objectives`, () =>
      HttpResponse.json({ items: [{ name: "minimizeDelay", value: 0 }] })
    )
  );
  return api;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).__readmeApi;
});

it("every README ts block runs", async () => {
  const blocks = tsBlocks();
  expect(blocks.length, "no ```ts block found in the README").toBeGreaterThan(0);
  // The error-handling example must also work on the path it illustrates:
  // a rejected submission (a 403 plan-size limit), so it runs a second
  // time at the end, with submissions rejected.
  const errorBlocks = blocks.filter((block) => block.includes("instanceof KardinalLimitError"));
  expect(errorBlocks.length, "the README lost its KardinalLimitError example").toBeGreaterThan(0);

  const api = fakeApi();
  (globalThis as Record<string, unknown>).__readmeApi = api;
  const source = asModule([...blocks, "globalThis.__readmeApi.rejectSubmit = true;", ...errorBlocks]);
  const file = join(mkdtempSync(join(tmpdir(), "kardinal-readme-")), "readme-blocks.ts");
  writeFileSync(file, source);

  vi.stubEnv("KARDINAL_API_KEY", "test-key");
  vi.stubEnv("KARDINAL_BASE_URL", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
  // wait() first polls after 10s: a fake clock keeps the test instant.
  vi.useFakeTimers();
  let outcome: { error?: unknown } | null = null;
  import(pathToFileURL(file).href).then(
    () => (outcome = {}),
    (error) => (outcome = { error })
  );
  while (outcome === null) await vi.advanceTimersByTimeAsync(1_000);
  expect((outcome as { error?: unknown }).error).toBeUndefined();
  expect(api.updated!.orders.map((o: { id: string }) => o.id)).toEqual(["order-1", "order-2"]);
});
