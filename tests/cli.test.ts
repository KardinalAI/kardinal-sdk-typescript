import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { server } from "./setup.js";
import { emit, fail, main } from "../src/cli.js";
import { KardinalLimitError, KardinalValidationError, examples } from "../src/index.js";
import { SDK_VERSION } from "../src/core/version.js";

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

  it("init writes a skill pointer file", async () => {
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      expect(await cli("init")).toBe(0);
      const written = join(dir, ".kardinal", "SKILL.md");
      expect(existsSync(written)).toBe(true);
      expect(readFileSync(written, "utf-8")).toContain("kardinal");
    } finally {
      process.chdir(cwd);
    }
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
    expect(issues).toContainEqual({ field: "bogusField", error: "Extra inputs are not permitted" });
  });

  it("update keeps fields this SDK doesn't know", async () => {
    let sent: any;
    server.use(
      http.put(PLAN_URL, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ item: { id: PLAN_ID, resources: [] } });
      })
    );
    const plan = { id: PLAN_ID, resources: [], futurePlanField: { a: 1 } };
    expect(await cli("routing", "plans", "update", file("plan.json", plan), "--json")).toBe(0);
    expect(sent.futurePlanField).toEqual({ a: 1 });
  });
});
