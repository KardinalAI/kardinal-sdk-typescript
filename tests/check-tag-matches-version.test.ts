// scripts/check-tag-matches-version.mjs guards the publish workflow: a tag
// that doesn't match the package version must stop the release.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../scripts/check-tag-matches-version.mjs", import.meta.url));
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));

const run = (tag: string) => spawnSync(process.execPath, [SCRIPT, tag], { encoding: "utf-8" });

describe("check-tag-matches-version", () => {
  it("passes for a tag matching the package version", () => {
    const result = run(`v${version}`);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("fails for a tag not matching the package version", () => {
    const result = run("v0.0.0");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(version);
  });

  it("fails for a tag without the v prefix", () => {
    expect(run(version).status).toBe(1);
  });
});
