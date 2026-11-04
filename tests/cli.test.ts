import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import yaml from "js-yaml";
import { server } from "./setup.js";
import { emit, fail, main } from "../src/cli.js";
import { KardinalLimitError, KardinalValidationError, examples } from "../src/index.js";
import { SDK_VERSION } from "../src/core/version.js";
import { typecheck } from "./typecheck.js";

const BASE = "https://app.kardinal.ai/api/v2";
const PLAN_ID = "4cbd0ab8-282c-4b30-b981-29e1ed8a2016";
const PLAN_URL = `${BASE}/plans/${PLAN_ID}`;
const NOT_FOUND = () => HttpResponse.json({ errors: [{ code: "NOT_FOUND", message: "no" }] }, { status: 404 });

let stdout: string;
let stderr: string;
let dir: string;

beforeEach(() => {
  stdout = "";
  stderr = "";
  vi.spyOn(console, "log").mockImplementation((...args) => void (stdout += args.join(" ") + "\n"));
  vi.spyOn(console, "error").mockImplementation((...args) => void (stderr += args.join(" ") + "\n"));
  // commander writes help and usage errors straight to the streams.
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => ((stdout += String(chunk)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => ((stderr += String(chunk)), true));
  vi.stubEnv("KARDINAL_API_KEY", "test-key");
  vi.stubEnv("KARDINAL_BASE_URL", "");
  vi.useFakeTimers();
  dir = mkdtempSync(join(tmpdir(), "kardinal-cli-"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Runs the CLI to completion, advancing the fake clock through retries
 * and `wait()` polls; resolves to the exit code. */
async function cli(...args: string[]): Promise<number> {
  let code: number | null = null;
  main(args).then((c) => (code = c));
  while (code === null) await vi.advanceTimersByTimeAsync(500);
  return code;
}

function file(name: string, content: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

describe("version, auth check, init", () => {
  it("version prints the package version and the API version", async () => {
    expect(await cli("version")).toBe(0);
    expect(stdout).toBe(`kardinal ${SDK_VERSION} (API v2)\n`);
  });

  it("auth check without an API key fails with clean JSON, not a stack trace", async () => {
    vi.stubEnv("KARDINAL_API_KEY", "");
    expect(await cli("auth", "check")).toBe(1);
    expect(JSON.parse(stdout).code).toBe("MISSING_API_KEY");
  });

  it("auth check reports the base URL and the agency", async () => {
    server.use(http.get(`${BASE}/plans`, () => HttpResponse.json({ agencyId: "BLD1234567_production", items: [] })));
    expect(await cli("auth", "check", "--json")).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ valid: true, baseUrl: BASE, agencyId: "BLD1234567_production" });
  });

  describe("init", () => {
    const SKILL_PATH = [".claude", "skills", "kardinal-typescript", "SKILL.md"];
    let cwd: string;

    beforeEach(() => {
      cwd = process.cwd();
      process.chdir(dir);
    });
    afterEach(() => process.chdir(cwd));

    const written = () => readFileSync(join(dir, ...SKILL_PATH), "utf-8");
    const tsBlock = () => /^```ts\n([\s\S]*?)^```/m.exec(written())![1];

    it("writes the skill under .claude/skills and no longer writes .kardinal/SKILL.md", async () => {
      expect(await cli("init")).toBe(0);
      expect(existsSync(join(dir, ...SKILL_PATH))).toBe(true);
      expect(existsSync(join(dir, ".kardinal", "SKILL.md"))).toBe(false);
    });

    it("starts with a YAML front matter holding exactly name and description, the name being the folder", async () => {
      await cli("init");
      const text = written();
      expect(text.startsWith("---\n")).toBe(true);
      const meta = yaml.load(text.split("---\n")[1]) as Record<string, string>;
      expect(Object.keys(meta).sort()).toEqual(["description", "name"]);
      expect(meta.name).toBe("kardinal-typescript");
      expect(meta.name).toBe(SKILL_PATH[2]);
      expect(meta.description.length).toBeGreaterThan(0);
    });

    it("cites the three pitfalls, the SDK version and the documentation links", async () => {
      await cli("init");
      const text = written();
      for (const part of [
        "5 seconds",
        "maxOptimizationDuration",
        "// sandbox value; in production, allow more than the plan's maxOptimizationDuration",
        "about one minute",
        "unaffectedStopIds",
        "final state",
        `(SDK ${SDK_VERSION})`,
        "https://developers.kardinal.ai/llms.txt",
        "https://developers.kardinal.ai/getting-started/agent-modeling-checklist",
        "- Integrating Kardinal into an application? Start with Integration paths. It lists the sections to read, in order: https://developers.kardinal.ai/getting-started/integration-paths",
        "- Start here if you're an AI agent (the modeling rules that Integration paths sends you to first): https://developers.kardinal.ai/getting-started/agent-modeling-checklist",
        "- Every page of the docs, for an agent: https://developers.kardinal.ai/llms.txt",
      ]) {
        expect(text).toContain(part);
      }
      expect(text.indexOf("getting-started/integration-paths")).toBeLessThan(
        text.indexOf("- Start here if you're an AI agent"),
      );
    });

    it("has a code block that type-checks", async () => {
      await cli("init");
      // typecheck.ts compiles without DOM types: declare the one global the block uses.
      const console = "declare const console: { log(...args: unknown[]): void };\n";
      expect(typecheck({ "skill.ts": console + tsBlock() + "\nexport {};\n" })).toEqual([]);
    });

    it("has a code block that runs against the API and lists the stops of a tour", async () => {
      await cli("init");
      const position = { latitude: 48.85, longitude: 2.35 };
      server.use(
        http.post(`${BASE}/plans`, () =>
          HttpResponse.json({ item: { id: PLAN_ID, version: 1 }, warnings: [] }, { status: 201 })
        ),
        http.get(PLAN_URL, () => HttpResponse.json({ item: { id: PLAN_ID, version: 1 } })),
        http.get(`${PLAN_URL}/state`, () => HttpResponse.json({ item: { state: "optimized", planVersion: 1 } })),
        http.get(`${PLAN_URL}/solution`, () =>
          HttpResponse.json({
            item: {
              planId: PLAN_ID,
              planVersion: 1,
              tours: [
                {
                  resourceId: "truck-1",
                  wayPoints: [
                    { type: "begin", position },
                    { type: "stop", stopId: "s1", position },
                    { type: "end", position },
                  ],
                },
              ],
            },
          })
        )
      );
      const sdkEntry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
      const source = tsBlock().replace('"@kardinal-ai/sdk"', JSON.stringify(sdkEntry));
      const path = join(mkdtempSync(join(tmpdir(), "kardinal-skill-")), "skill-block.ts");
      writeFileSync(path, source);
      const printed: unknown[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => void printed.push(args));
      let outcome: { error?: unknown } | null = null;
      import(pathToFileURL(path).href).then(
        () => (outcome = {}),
        (error) => (outcome = { error })
      );
      while (outcome === null) await vi.advanceTimersByTimeAsync(1_000);
      expect((outcome as { error?: unknown }).error).toBeUndefined();
      expect(printed[0]).toEqual(["truck-1", ["s1"]]);
    });

    it("prints the absolute path and how to reload skills", async () => {
      expect(await cli("init")).toBe(0);
      expect(stdout).toContain(`Wrote ${realpathSync(join(dir, ...SKILL_PATH))}`);
      expect(stdout).toContain("/reload-skills");
      expect(stdout).not.toContain("can be deleted");
    });

    it("leaves an existing .kardinal/SKILL.md untouched and says it can be deleted", async () => {
      mkdirSync(join(dir, ".kardinal"));
      writeFileSync(join(dir, ".kardinal", "SKILL.md"), "old");
      await cli("init");
      expect(readFileSync(join(dir, ".kardinal", "SKILL.md"), "utf-8")).toBe("old");
      expect(stdout).toContain(".kardinal/SKILL.md is no longer written by `kardinal init`: it can be deleted.");
    });

    it("gives the same content when run twice", async () => {
      await cli("init");
      const first = written();
      await cli("init");
      expect(written()).toBe(first);
    });
  });
});

describe("usage errors exit with code 2", () => {
  it.each([
    [[]],
    [["routing"]],
    [["bogus"]],
    [["routing", "plans", "list", "--archived", "bogus"]],
    [["routing", "plans", "list", "--page", "abc"]],
    [["routing", "plans", "submit", "/nonexistent.json"]],
    [["routing", "solutions", "wait", PLAN_ID, "--timeout", "soon"]],
  ])("%j", async (args) => {
    expect(await cli(...args)).toBe(2);
  });

  it("--help exits with code 0", async () => {
    expect(await cli("--help")).toBe(0);
    expect(stdout).toContain("routing");
  });
});

describe("plan files", () => {
  it("validate rejects a malformed plan with every problem", async () => {
    expect(await cli("routing", "plans", "validate", file("bad.json", { resources: [{ id: "r1" }] }))).toBe(1);
    expect(stdout).toContain("vehicleProfile");
  });

  it("validate accepts the example plan", async () => {
    expect(await cli("routing", "plans", "validate", file("good.json", examples.smallDeliveryPlan()))).toBe(0);
    expect(stdout).toContain("OK");
  });

  it("validate reports invalid JSON as a field error", async () => {
    expect(await cli("routing", "plans", "validate", file("bad.json", "{bad"))).toBe(1);
    const [issue] = JSON.parse(stdout);
    expect(issue.field).toBe("");
    expect(issue.error).toMatch(/^Invalid JSON: /);
  });

  it("submit rejects a malformed plan with a clean error, not a stack trace", async () => {
    expect(await cli("routing", "plans", "submit", file("bad.json", { resources: [{ id: "r1" }] }))).toBe(1);
    expect(stdout).toContain("vehicleProfile");
  });

  it("update rejects a malformed plan with a clean error, not a stack trace", async () => {
    expect(await cli("routing", "plans", "update", file("bad.json", { resources: [{ id: "r1" }] }))).toBe(1);
    expect(stdout).toContain("vehicleProfile");
  });
});

describe("API errors exit with code 1 and clean JSON", () => {
  it("submit", async () => {
    server.use(
      http.post(`${BASE}/plans`, () =>
        HttpResponse.json({ errors: [{ code: "INVALID_INPUT", message: "no" }] }, { status: 400 })
      )
    );
    expect(await cli("routing", "plans", "submit", file("plan.json", examples.smallDeliveryPlan()))).toBe(1);
    expect(JSON.parse(stdout).code).toBe("INVALID_INPUT");
  });

  it("update", async () => {
    server.use(http.put(PLAN_URL, NOT_FOUND));
    expect(await cli("routing", "plans", "update", file("plan.json", { id: PLAN_ID, resources: [] }))).toBe(1);
    expect(JSON.parse(stdout).code).toBe("NOT_FOUND");
  });

  it("get", async () => {
    server.use(http.get(PLAN_URL, NOT_FOUND));
    expect(await cli("routing", "plans", "get", PLAN_ID, "--json")).toBe(1);
    expect(JSON.parse(stdout).code).toBe("NOT_FOUND");
  });

  it("delete", async () => {
    server.use(http.delete(PLAN_URL, NOT_FOUND));
    expect(await cli("routing", "plans", "delete", PLAN_ID)).toBe(1);
  });

  it("list", async () => {
    server.use(http.get(`${BASE}/plans`, () => new HttpResponse(null, { status: 500 })));
    expect(await cli("routing", "plans", "list", "--json")).toBe(1);
    expect(JSON.parse(stdout).code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("start and stop", async () => {
    server.use(http.put(`${PLAN_URL}/running`, NOT_FOUND));
    expect(await cli("routing", "plans", "start", PLAN_ID)).toBe(1);
    expect(await cli("routing", "plans", "stop", PLAN_ID)).toBe(1);
  });

  it("status", async () => {
    server.use(http.get(`${PLAN_URL}/state`, NOT_FOUND));
    expect(await cli("routing", "plans", "status", PLAN_ID)).toBe(1);
  });

  it("solutions get and objectives", async () => {
    server.use(http.get(`${PLAN_URL}/solution`, NOT_FOUND), http.get(`${PLAN_URL}/solution/objectives`, NOT_FOUND));
    expect(await cli("routing", "solutions", "get", PLAN_ID)).toBe(1);
    expect(await cli("routing", "solutions", "objectives", PLAN_ID)).toBe(1);
  });

  it("solutions wait", async () => {
    server.use(http.get(PLAN_URL, NOT_FOUND));
    expect(await cli("routing", "solutions", "wait", PLAN_ID)).toBe(1);
  });

  it("demo", async () => {
    server.use(
      http.post(`${BASE}/plans`, () =>
        HttpResponse.json({ errors: [{ code: "INVALID_INPUT", message: "no" }] }, { status: 400 })
      )
    );
    expect(await cli("routing", "demo")).toBe(1);
  });
});

describe("commands", () => {
  const optimized = () => [
    http.get(PLAN_URL, () => HttpResponse.json({ item: { id: PLAN_ID, resources: [] } })),
    http.get(`${PLAN_URL}/state`, () => HttpResponse.json({ item: { state: "optimized" } })),
    http.get(`${PLAN_URL}/solution`, () => HttpResponse.json({ item: {} })),
  ];

  it("submit --json", async () => {
    server.use(http.post(`${BASE}/plans`, () => HttpResponse.json({ item: { id: PLAN_ID, resources: [] } }, { status: 201 })));
    expect(await cli("routing", "plans", "submit", file("plan.json", examples.smallDeliveryPlan()), "--json")).toBe(0);
    expect(JSON.parse(stdout).id).toBe(PLAN_ID);
  });

  it("get", async () => {
    server.use(http.get(PLAN_URL, () => HttpResponse.json({ item: { id: PLAN_ID, resources: [], tz: null } })));
    expect(await cli("routing", "plans", "get", PLAN_ID, "--json")).toBe(0);
    const plan = JSON.parse(stdout);
    expect(plan.id).toBe(PLAN_ID);
    expect(plan).not.toHaveProperty("tz"); // null fields dropped, like the Python CLI
  });

  it("update --force", async () => {
    let force: string | null = null;
    server.use(
      http.put(PLAN_URL, ({ request }) => {
        force = new URL(request.url).searchParams.get("force");
        return HttpResponse.json({ item: { id: PLAN_ID, resources: [] } });
      })
    );
    expect(
      await cli("routing", "plans", "update", file("plan.json", { id: PLAN_ID, resources: [] }), "--force", "--json")
    ).toBe(0);
    expect(JSON.parse(stdout).id).toBe(PLAN_ID);
    expect(force).toBe("true");
  });

  it("delete", async () => {
    server.use(http.delete(PLAN_URL, () => new HttpResponse(null, { status: 204 })));
    expect(await cli("routing", "plans", "delete", PLAN_ID)).toBe(0);
    expect(stdout).toContain("OK");
  });

  it("list", async () => {
    let url: URL | undefined;
    server.use(
      http.get(`${BASE}/plans`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ items: [{ id: PLAN_ID }], paging: { total: 1, totalPages: 1, page: 2 } });
      })
    );
    expect(await cli("routing", "plans", "list", "--page", "2", "--archived", "only", "--json")).toBe(0);
    expect(JSON.parse(stdout)[0].id).toBe(PLAN_ID);
    expect(url?.searchParams.get("page")).toBe("2");
    expect(url?.searchParams.get("archived")).toBe("only");
  });

  it("start --force and stop print the plan reference", async () => {
    const forces: (string | null)[] = [];
    server.use(
      http.put(`${PLAN_URL}/running`, ({ request }) => {
        forces.push(new URL(request.url).searchParams.get("force"));
        return HttpResponse.json({ planId: PLAN_ID, planVersion: 1 });
      })
    );
    expect(await cli("routing", "plans", "start", PLAN_ID, "--force", "--json")).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ planId: PLAN_ID, planVersion: 1 });
    expect(await cli("routing", "plans", "stop", PLAN_ID, "--json")).toBe(0);
    expect(forces).toEqual(["true", "false"]);
  });

  it("status", async () => {
    server.use(http.get(`${PLAN_URL}/state`, () => HttpResponse.json({ item: { state: "optimized" } })));
    expect(await cli("routing", "plans", "status", PLAN_ID, "--json")).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ state: "optimized" });
  });

  it("status prints a state this SDK doesn't know", async () => {
    server.use(http.get(`${PLAN_URL}/state`, () => HttpResponse.json({ item: { state: "someFutureState" } })));
    expect(await cli("routing", "plans", "status", PLAN_ID, "--json")).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ state: "someFutureState" });
  });

  it("solutions get and objectives", async () => {
    server.use(
      http.get(`${PLAN_URL}/solution`, () => HttpResponse.json({ item: {} })),
      http.get(`${PLAN_URL}/solution/objectives`, () => HttpResponse.json({ items: [] }))
    );
    expect(await cli("routing", "solutions", "get", PLAN_ID, "--json")).toBe(0);
    stdout = "";
    expect(await cli("routing", "solutions", "objectives", PLAN_ID, "--json")).toBe(0);
    expect(JSON.parse(stdout)).toEqual([]);
  });

  it("solutions wait --timeout (seconds)", async () => {
    server.use(...optimized());
    expect(await cli("routing", "solutions", "wait", PLAN_ID, "--timeout", "600", "--json")).toBe(0);
    expect(JSON.parse(stdout).finalState).toBe("optimized");
  });

  it("demo prints the plan id to stderr before waiting", async () => {
    server.use(
      http.post(`${BASE}/plans`, () => HttpResponse.json({ item: { id: PLAN_ID, resources: [] } }, { status: 201 })),
      ...optimized()
    );
    expect(await cli("routing", "demo", "--json")).toBe(0);
    expect(stderr).toContain(`Submitted plan ${PLAN_ID}`);
  });
});

describe("request headers", () => {
  it("CLI requests are marked cli in the User-Agent", async () => {
    const seen: Headers[] = [];
    server.use(
      http.get(PLAN_URL, ({ request }) => {
        seen.push(request.headers);
        return HttpResponse.json({ item: { id: PLAN_ID, resources: [] } });
      }),
      http.get(`${BASE}/plans`, ({ request }) => {
        seen.push(request.headers);
        return HttpResponse.json({ items: [], agencyId: "a" });
      })
    );
    expect(await cli("routing", "plans", "get", PLAN_ID, "--json")).toBe(0);
    expect(await cli("auth", "check", "--json")).toBe(0);
    for (const headers of seen) {
      expect(headers.get("User-Agent")).toMatch(new RegExp(`^kardinal-sdk-typescript/${SDK_VERSION} \\(cli; Node/`));
      expect(headers.get("X-Kardinal-Client")).toBe(`kardinal-sdk-typescript/${SDK_VERSION}`);
    }
  });
});

describe("emit and fail", () => {
  function asTty(isTty: boolean) {
    const original = process.stdout.isTTY;
    process.stdout.isTTY = isTty;
    return () => void (process.stdout.isTTY = original);
  }

  it("emit prints a readable table on a terminal", () => {
    const restore = asTty(true);
    try {
      emit({ id: "p1", state: "optimized" });
    } finally {
      restore();
    }
    expect(stdout).toContain("p1");
    expect(stdout).not.toContain("{");
    expect(stdout).not.toContain('"'); // strings printed raw
  });

  it("emit prints a table row per list item, and plain values as is", () => {
    const restore = asTty(true);
    try {
      emit([{ id: "p1" }, { id: "p2" }]);
      emit(["a", "b"]);
    } finally {
      restore();
    }
    for (const value of ["p1", "p2", "a", "b"]) expect(stdout).toContain(value);
  });

  it("fail prints JSON with the retryable flag", () => {
    const err = new KardinalValidationError("bad input", {
      code: "INVALID_VALUE",
      status: 400,
      requestId: null,
      retryable: false,
      errors: [{ code: "INVALID_VALUE", message: "bad" }],
    });
    expect(() => fail(err)).toThrow();
    expect(JSON.parse(stdout)).toMatchObject({ code: "INVALID_VALUE", retryable: false });
  });

  it("fail shows details, so each kind of limit can be told apart", () => {
    const err = new KardinalLimitError("The requested action is not allowed.", {
      code: "NOT_ALLOWED",
      status: 403,
      requestId: null,
      retryable: false,
      errors: [{ code: "NOT_ALLOWED", message: "no", properties: { details: "Monthly credit quota exhausted" } }],
    });
    expect(() => fail(err)).toThrow();
    expect(JSON.parse(stdout).details).toBe("Monthly credit quota exhausted");
  });
});

describe("plan files, wording and round trip", () => {
  it("words a missing field and an unknown field like the Python CLI", async () => {
    const plan = { resources: [{ id: "r1", workingTimeWindow: { begin: "a", end: "b" } }], bogusField: 1 };
    expect(await cli("routing", "plans", "validate", file("bad.json", plan))).toBe(1);
    const issues = JSON.parse(stdout);
    expect(issues).toContainEqual({ field: "resources.0.vehicleProfile", error: "Field required" });
    expect(issues).toContainEqual({ field: "bogusField", error: "Unknown field" });
  });

  it("update keeps fields this SDK doesn't know", async () => {
    // The stored plan carries the field, so the provenance the command reads
    // vouches for it. Without the GET below this passed for the wrong reason:
    // the lookup failed, and the weaker check lets anything through.
    const plan = { id: PLAN_ID, resources: [], futurePlanField: { a: 1 } };
    let sent: any;
    server.use(
      http.get(PLAN_URL, () => HttpResponse.json({ item: plan })),
      http.put(PLAN_URL, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ item: { id: PLAN_ID, resources: [] } });
      })
    );
    expect(await cli("routing", "plans", "update", file("plan.json", plan), "--json")).toBe(0);
    expect(sent.futurePlanField).toEqual({ a: 1 });
  });
});

describe("unknown fields on the command line", () => {
  const RESOURCE = {
    id: "r1",
    vehicleProfile: { type: "car" },
    workingTimeWindow: { begin: "2026-10-08T08:00:00Z", end: "2026-10-08T18:00:00Z" },
  };

  /** Serves `stored` on GET, records what a PUT or POST sent. */
  function serving(stored: unknown) {
    const state: { sent?: any } = {};
    const record = async ({ request }: { request: Request }) => {
      state.sent = await request.json();
      return HttpResponse.json({ item: { id: PLAN_ID, resources: [] } });
    };
    server.use(
      http.get(PLAN_URL, () => HttpResponse.json({ item: stored })),
      http.put(PLAN_URL, record),
      http.post(`${BASE}/plans`, record)
    );
    return state;
  }

  it("update refuses a typo the stored plan gives no cover for", async () => {
    // The point of reading the stored plan first: from a file alone there is
    // nothing to tell a typo from a field the API added, so update() could
    // only warn — and send it.
    serving({ id: PLAN_ID, resources: [RESOURCE] });
    const edited = { id: PLAN_ID, resources: [{ ...RESOURCE, maxWorkingDurationn: "PT8H" }] };
    expect(await cli("routing", "plans", "update", file("plan.json", edited), "--json")).toBe(1);
    expect(JSON.parse(stdout)).toContainEqual({
      field: "resources[0].maxWorkingDurationn",
      error: "Unknown field — did you mean maxWorkingDuration?",
    });
  });

  it("--allow-unknown sends the named key and still refuses the rest", async () => {
    const state = serving({ id: PLAN_ID, resources: [RESOURCE] });
    const plan = { id: PLAN_ID, resources: [{ ...RESOURCE, aNewApiField: "x" }] };
    const path = file("plan.json", plan);
    expect(
      await cli("routing", "plans", "update", path, "--allow-unknown", "aNewApiField", "--json")
    ).toBe(0);
    expect(state.sent.resources[0].aNewApiField).toBe("x");

    const withTypo = {
      id: PLAN_ID,
      resources: [{ ...RESOURCE, aNewApiField: "x", maxWorkingDurationn: "PT8H" }],
    };
    stdout = "";
    expect(
      await cli(
        "routing", "plans", "update", file("two.json", withTypo),
        "--allow-unknown", "aNewApiField", "--json"
      )
    ).toBe(1);
    expect(JSON.parse(stdout)).toHaveLength(1);
  });

  it("--allow-unknown is repeatable, on submit and on validate", async () => {
    const state = serving({ id: PLAN_ID, resources: [] });
    const plan = { resources: [{ ...RESOURCE, fieldOne: 1, fieldTwo: 2 }], orders: [] };
    const path = file("plan.json", plan);
    const flags = ["--allow-unknown", "fieldOne", "--allow-unknown", "fieldTwo"];

    expect(await cli("routing", "plans", "validate", path, ...flags)).toBe(0);
    expect(await cli("routing", "plans", "submit", path, ...flags, "--json")).toBe(0);
    expect(state.sent.resources[0]).toMatchObject({ fieldOne: 1, fieldTwo: 2 });
  });

  it("explains a server-assigned key instead of guessing a typo", async () => {
    // Re-submitting a plan read back from the API is the common mistake.
    // "did you mean..." would be unhelpful advice here.
    const plan = { id: PLAN_ID, version: 3, resources: [RESOURCE], orders: [] };
    expect(await cli("routing", "plans", "validate", file("plan.json", plan))).toBe(1);
    const issues = JSON.parse(stdout);
    for (const field of ["id", "version"]) {
      expect(issues).toContainEqual({
        field,
        error: "Unknown field — not a field you set: the server assigns it",
      });
    }
  });

  it("prints a warning it cannot check exactly in the CLI's own format", async () => {
    // A plan the SDK never read: nothing to sort by, so update() warns rather
    // than refusing. It must read like the CLI's other output, on stderr, and
    // never contaminate --json on stdout.
    server.use(
      http.get(PLAN_URL, NOT_FOUND),
      http.put(PLAN_URL, () => HttpResponse.json({ item: { id: PLAN_ID, resources: [] } }))
    );
    const edited = { id: PLAN_ID, resources: [{ ...RESOURCE, maxWorkingDurationn: "PT8H" }] };
    expect(await cli("routing", "plans", "update", file("plan.json", edited), "--json")).toBe(0);
    expect(stderr).toContain("warning: ");
    expect(stderr).toContain("maxWorkingDuration");
    expect(() => JSON.parse(stdout)).not.toThrow();
  });
});
