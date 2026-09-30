import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

it("regenerating the types from the spec produces no diff", () => {
  const result = spawnSync("bash", ["scripts/check-types-no-diff.sh"], { cwd: ROOT, encoding: "utf-8" });
  expect(result.status, result.stdout + result.stderr).toBe(0);
}, 60_000);
