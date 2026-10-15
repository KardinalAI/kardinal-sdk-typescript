// Everything user code needs is importable from the package root — no deep
// import into the package's internals in anything shown to users.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as sdk from "../src/index.js";
import * as auth from "../src/core/auth.js";
import * as errors from "../src/core/errors.js";

const PUBLIC = [
  "Kardinal",
  "KardinalError",
  "KardinalAuthError",
  "KardinalLimitError",
  "KardinalForbiddenError",
  "KardinalValidationError",
  "KardinalNotFoundError",
  "KardinalRateLimitError",
  "KardinalServerError",
  "KardinalTimeoutError",
  "KardinalOptimizationError",
  "KardinalConnectionError",
  "MissingApiKeyError",
  "EmptyApiKeyError",
  "parsePlanCreate",
  "examples",
];

describe("public exports", () => {
  it("exports the public names from the package root", () => {
    for (const name of PUBLIC) expect(sdk, name).toHaveProperty(name);
  });

  it("exports every error class", () => {
    const defined = Object.entries({ ...errors, ...auth })
      .filter(([, value]) => typeof value === "function" && value.prototype instanceof Error)
      .map(([name]) => name);
    for (const name of defined) expect((sdk as Record<string, unknown>)[name], name).toBe({ ...errors, ...auth }[name]);
  });

  it("the README never shows a deep import", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf-8");
    expect(readme).not.toMatch(/from "@kardinal-ai\/sdk\//);
  });
});
