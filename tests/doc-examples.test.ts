/**
 * The TypeScript examples of the SDK pages and guides of the docs, copied
 * into tests/doc-examples/ by `npm run sync:doc-examples`: each page is
 * compiled (all pages in one program) and run, its blocks in order as one
 * module, against a mocked API, then its results are compared with EXPECTED.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { examples, Kardinal } from "../src/index.js";
import { server } from "./setup.js";
import { typecheck } from "./typecheck.js";

const BASE = "https://app.kardinal.ai/api/v2";
const PLAN_ID = "4cbd0ab8-282c-4b30-b981-29e1ed8a2016";
const POSITION = { lat: 48.85, lon: 2.35 };
const PLAN_URL = `${BASE}/plans/${PLAN_ID}`;
const SDK_ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const PAGES_DIR = new URL("./doc-examples/", import.meta.url);
const SDK_SPECIFIER = "@kardinal-ai/sdk";

const CLAMPED = {
  code: "INVALID_VALUE",
  message: "The field value is not valid.",
  properties: { path: "maxOptimizationDuration", details: "clamped to 5s" },
};

// Names a page uses without defining them, and names of its functions that
// the page does not export (the test calls them).
const PRELUDE: Record<string, string> = {
  "sdks__errors-and-warnings": [
    `const k = new Kardinal();`,
    `const planInput = examples.smallDeliveryPlan();`,
    `var plan: Awaited<ReturnType<typeof k.routing.plans.submit>>;`,
  ].join("\n"),
};
const PRELUDE_IMPORTS: Record<string, string[]> = { "sdks__errors-and-warnings": ["Kardinal", "examples"] };
const EXPORTS: Record<string, string[]> = {
  "sdks__configuration": ["k"],
  "sdks__plan-lifecycle": ["current", "replaced"],
  "sdks__building-plans": ["created"],
  "guides__breaks": ["plan"],
  "guides__capacities": ["plan"],
  "guides__multi-day": ["plan", "checkNights"],
  "guides__orders-and-sequences": ["plan"],
  "guides__resource-limits": ["plan", "seconds", "checkLimits"],
  "guides__time-windows": ["plan"],
};

function pageNames(): string[] {
  return readdirSync(PAGES_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => f.slice(0, -3))
    .sort();
}

/** The blocks of a copied page, without the header and "// ---" comments. */
function blocksOf(page: string): string[] {
  const text = readFileSync(new URL(`${page}.ts`, PAGES_DIR), "utf-8");
  return text
    .split(/^\/\/ --- .*$/m)
    .slice(1)
    .map((block) => block.trim() + "\n");
}

/** A page as one module, the blocks in order: imports hoisted and merged
 * (type-only ones as `import type`), top-level `const`/`let` turned into
 * `var` since blocks redeclare names, as a reader re-running them would.
 * Because of that rewrite, "Type 'string' is not assignable to ..." from
 * the compile test may come from this test, not from the page. */
function asModule(page: string, sdk: string): string {
  const values = new Set<string>(PRELUDE_IMPORTS[page]);
  const types = new Set<string>();
  const others: string[] = [];
  const body: string[] = [PRELUDE[page] ?? ""];
  for (const block of blocksOf(page)) {
    for (const line of block.split("\n")) {
      const sdkImport = /^import (type )?\{([^}]*)\} from "@kardinal-ai\/sdk";$/.exec(line);
      if (sdkImport) {
        for (const name of sdkImport[2].split(",")) (sdkImport[1] ? types : values).add(name.trim());
        continue;
      }
      if (/^import /.test(line)) {
        expect(line, "a doc import this test doesn't handle").toMatch(/^import \{[^}]*\} from "node:[a-z]+";$/);
        others.push(line);
        continue;
      }
      body.push(line.replace(/^(const|let) /, "var "));
    }
  }
  const header = [
    ...others,
    values.size ? `import { ${[...values].join(", ")} } from ${JSON.stringify(sdk)};` : "",
    types.size ? `import type { ${[...types].join(", ")} } from ${JSON.stringify(sdk)};` : "",
  ];
  const exported = EXPORTS[page] ?? [];
  const tail = exported.length ? `export { ${exported.join(", ")} };` : "";
  return [...header, ...body, tail].join("\n");
}

/** A mocked API: echoes submitted plans back with an id and a version,
 * reports every plan as optimized with a one-tour solution, and keeps the
 * order of the GETs it serves. */
function fakeApi() {
  const api = {
    plan: null as Record<string, any> | null,
    requests: [] as string[],
    deleted: false,
  };
  const log = (name: string) => api.requests.push(name);
  server.use(
    http.post(`${BASE}/plans`, async ({ request }) => {
      api.plan = { ...((await request.json()) as object), id: PLAN_ID, version: 1 };
      return HttpResponse.json({ item: api.plan, warnings: [CLAMPED] }, { status: 201 });
    }),
    http.put(PLAN_URL, async ({ request }) => {
      api.plan = { ...((await request.json()) as object), id: PLAN_ID, version: api.plan!.version + 1 };
      return HttpResponse.json({ item: api.plan });
    }),
    http.get(PLAN_URL, () => HttpResponse.json({ item: api.plan })),
    http.delete(PLAN_URL, () => {
      api.deleted = true;
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(`${PLAN_URL}/state`, () => {
      log("state");
      return HttpResponse.json({ item: { state: "optimized", planVersion: api.plan!.version } });
    }),
    http.get(`${PLAN_URL}/solution`, () => {
      log("solution");
      return HttpResponse.json({
        item: {
          planId: PLAN_ID,
          planVersion: api.plan!.version,
          tours: [
            {
              resourceId: api.plan!.resources[0].id,
              wayPoints: [
                { type: "begin", position: POSITION },
                {
                  type: "stop",
                  stopId: "stop-1",
                  arrivalTime: "2026-10-29T09:50:00+01:00",
                  beginTime: "2026-10-29T10:00:00+01:00",
                  delay: "PT0S",
                  position: POSITION,
                },
                { type: "end", position: POSITION },
              ],
            },
          ],
        },
      });
    }),
    http.get(`${PLAN_URL}/solution/objectives`, () => {
      log("objectives");
      return HttpResponse.json({ items: [{ name: "minimizeDelay", value: 0 }] });
    }),
    http.put(`${PLAN_URL}/running`, () => {
      log("running");
      return HttpResponse.json({ planId: PLAN_ID, planVersion: api.plan!.version });
    }),
    http.get(`${BASE}/plans`, () =>
      HttpResponse.json({
        agencyId: "A_sandbox",
        items: [{ id: PLAN_ID, version: 1, state: "optimized" }],
        paging: { page: 1, totalPages: 1, total: 1, itemsPerPage: 20 },
      })
    )
  );
  return api;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Runs a page, with wait() on a fake clock, in a folder holding plan.json;
 * returns its exports, what it printed and the mocked API. */
async function runPage(page: string) {
  const api = fakeApi();
  const dir = mkdtempSync(join(tmpdir(), "kardinal-doc-"));
  const file = join(dir, `${page}.ts`);
  writeFileSync(file, asModule(page, SDK_ENTRY));
  writeFileSync(join(dir, "plan.json"), JSON.stringify(examples.smallDeliveryPlan()));
  const cwd = process.cwd();
  process.chdir(dir);
  vi.stubEnv("KARDINAL_API_KEY", "test-key");
  vi.stubEnv("KARDINAL_BASE_URL", "");
  const printed: unknown[][] = [];
  vi.spyOn(console, "log").mockImplementation((...args) => void printed.push(args));
  vi.useFakeTimers();
  try {
    let outcome: { module?: Record<string, any>; error?: unknown } | null = null;
    import(pathToFileURL(file).href).then(
      (module) => (outcome = { module }),
      (error) => (outcome = { error })
    );
    while (outcome === null) await vi.advanceTimersByTimeAsync(1_000);
    expect((outcome as { error?: unknown }).error).toBeUndefined();
    return { mod: (outcome as { module: Record<string, any> }).module, printed, api };
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

const lines = (printed: unknown[][]) => printed.map((args) => args.join(" "));

// What each page must produce: checked on the results, not only on "it ran".
const EXPECTED: Record<string, () => Promise<void>> = {
  "sdks__plan-lifecycle": async () => {
    const { mod, printed, api } = await runPage("sdks__plan-lifecycle");
    // The `if (state === "optimized")` branch was taken: the solution is read
    // between the state and the objectives (the compiler can't catch a wrong
    // state name).
    const at = api.requests.lastIndexOf("objectives");
    expect(api.requests.slice(at - 2, at + 1)).toEqual(["state", "solution", "objectives"]);
    expect(mod.current.version).toBe(2); // update
    expect(mod.current.orders.map((o: { id: string }) => o.id)).toContain("order-10");
    expect(mod.replaced.version).toBe(3); // then replace, with a new input
    expect(mod.replaced.orders.map((o: { id: string }) => o.id)).not.toContain("order-10");
    expect(api.requests.filter((r) => r === "running")).toHaveLength(2);
    expect(api.deleted).toBe(true);
    expect(printed).toContainEqual([PLAN_ID, 1]); // plan.id, plan.version
    expect(printed).toContainEqual([1, 1, null]); // page.total, totalPages, nextPage
  },
  "sdks__quickstart": async () => {
    const { printed } = await runPage("sdks__quickstart");
    expect(printed[0]).toEqual(["optimized"]);
    expect(
      printed.some(
        (line) =>
          line.includes("stop-1") &&
          line.includes("2026-10-29T09:50:00+01:00") &&
          line.includes("2026-10-29T10:00:00+01:00"),
      ),
    ).toBe(true);
    expect(printed.some((line) => line[0] === "Not planned:")).toBe(true);
  },
  "sdks__configuration": async () => {
    const { mod } = await runPage("sdks__configuration");
    expect(mod.k).toBeInstanceOf(Kardinal);
  },
  "sdks__building-plans": async () => {
    const { mod, printed, api } = await runPage("sdks__building-plans");
    expect(mod.created.id).toBe(PLAN_ID);
    expect(api.plan!.orders.length).toBeGreaterThan(0);
    expect(printed).toEqual([]); // unknownFields printed nothing
  },
  "sdks__errors-and-warnings": async () => {
    const { printed } = await runPage("sdks__errors-and-warnings");
    expect(printed[0][0]).toBe("INVALID_VALUE");
  },
  "guides__orders-and-sequences": async () => {
    const { mod } = await runPage("guides__orders-and-sequences");
    expect(mod.plan.orders).toHaveLength(3);
    const solution = {
      tours: [{ resourceId: "van-1", wayPoints: [{ type: "stop", stopId: "drop-near" }] }],
      unaffectedStopIds: ["pickup-1"],
    };
    expect(mod.checkOrders(mod.plan, solution)).toEqual(["order-1: pickup-1 is left out"]);
    expect(mod.checkOrders(mod.plan, { tours: [], unaffectedStopIds: [] })).toEqual([
      "order-3: no candidate of drop-site is in a tour",
    ]);
  },
  "guides__resource-limits": async () => {
    const { mod } = await runPage("guides__resource-limits");
    expect(mod.plan.orders).toHaveLength(4);
    expect(mod.seconds("PT1H39M40S")).toBe(5980);
    expect(mod.checkLimits({ workingDuration: "PT4H", distanceInKm: 10 }, { maxWorkingDuration: "PT3H" })).toEqual([
      "workingDuration PT4H is over PT3H",
    ]);
    expect(mod.checkLimits({ workingDuration: "PT1H", distanceInKm: 120 }, { maxDistanceInKm: 100 })).toEqual([
      "distanceInKm 120 is over 100",
    ]);
    expect(mod.checkLimits({ workingDuration: "PT1H", distanceInKm: 50 }, { maxDistanceInKm: 100 })).toEqual([]);
  },
  "guides__skills-and-assignments": async () => {
    const { mod, printed } = await runPage("guides__skills-and-assignments");
    expect(mod.plan.orders).toHaveLength(3);
    printed.length = 0;
    mod.check({
      unaffectedStopIds: ["stop-panel"],
      tours: [
        {
          resourceId: "tech-plain",
          isValid: false,
          violations: [{ type: "skills", lackingSkills: ["gas-certified"] }, { type: "forbiddenAssignment" }],
        },
      ],
    });
    expect(lines(printed)).toEqual([
      "stop-panel was not planned",
      "tech-plain NOT VALID",
      "  tech-plain lacks gas-certified",
      "  tech-plain is barred by a forbiddenAssignment",
    ]);
  },
  "guides__time-windows": async () => {
    const { mod, printed } = await runPage("guides__time-windows");
    expect(mod.plan.orders).toHaveLength(2);
    printed.length = 0;
    mod.check(mod.plan, {
      unaffectedStopIds: [],
      tours: [
        {
          resourceId: "van-1",
          wayPoints: [
            { type: "stop", stopId: "stop-clinic", beginTime: "2026-10-29 10:30", delay: "PT0S" },
            // 08:30 is in a window that needs the "certified" tag, which van-1 lacks.
            { type: "stop", stopId: "stop-clinic", beginTime: "2026-10-29 08:30", delay: "PT0S" },
            { type: "stop", stopId: "stop-shop", beginTime: "2026-10-29 07:00", delay: "PT1H" },
          ],
        },
      ],
    });
    expect(lines(printed)).toEqual([
      "stop-clinic authorized: ok delay: PT0S",
      "stop-clinic authorized: OUTSIDE delay: PT0S",
      "stop-shop authorized: ok delay: PT1H",
    ]);
  },
  "guides__breaks": async () => {
    const { mod } = await runPage("guides__breaks");
    expect(mod.plan.orders.map((o: { id: string }) => o.id)).toEqual(["order-morning", "order-afternoon"]);
    expect(mod.plan.resources[0].breaks).toHaveLength(1);
  },
  "guides__multi-day": async () => {
    const { mod } = await runPage("guides__multi-day");
    expect(mod.plan.orders).toHaveLength(4);
    expect(mod.plan.resources[0].breaks).toHaveLength(2);
    // The guide's night check: a rest between two days passes, a missing one is reported.
    const stop1 = { type: "stop", arrivalTime: "2026-11-09T15:00:00+01:00" };
    const rest = {
      type: "break",
      arrivalTime: "2026-11-09T19:00:00+01:00",
      departureTime: "2026-11-10T06:00:00+01:00",
      fromPrevious: { travelDuration: "PT0S" },
    };
    const stop2 = { type: "stop", arrivalTime: "2026-11-10T11:00:00+01:00" };
    expect(mod.checkNights({ wayPoints: [stop1, rest, stop2] }, "Europe/Paris")).toEqual([]);
    expect(mod.checkNights({ wayPoints: [stop1, stop2] }, "Europe/Paris")).toHaveLength(1);
  },
  "guides__capacities": async () => {
    const { mod } = await runPage("guides__capacities");
    expect(mod.plan.orders.map((o: { id: string }) => o.id)).toEqual(["order-1", "order-2", "order-3", "order-4"]);
    expect(mod.plan.orders[0].stops[0].capacities).toEqual({ weight: 200, nbDeliveries: 1 });
  },
};

it("every copied page has expected values", () => {
  // An entry may land before its page; a page with blocks needs an entry.
  expect(pageNames(), "tests/doc-examples/ is empty: run npm run sync:doc-examples").not.toEqual([]);
  expect(pageNames().filter((page) => !(page in EXPECTED))).toEqual([]);
});

it("every copied page compiles against the SDK sources", () => {
  const modules = Object.fromEntries(pageNames().map((page) => [`${page}.ts`, asModule(page, SDK_SPECIFIER)]));
  expect(typecheck(modules)).toEqual([]);
});

describe.each(Object.keys(EXPECTED).filter((page) => pageNames().includes(page)))("%s", (page) => {
  it("runs against the mocked API and gives the expected values", EXPECTED[page]);
});
