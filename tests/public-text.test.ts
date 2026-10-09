/**
 * The README becomes the npmjs.com page and the JSDoc shows up in editors:
 * neither may carry internal details or claims we haven't verified.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GENERATED = join(ROOT, "src", "routing", "generated-types.ts");

// Internal environments and hosts, the GitLab path, a fake key format (API
// keys are JWTs), the webhook endpoints (x-excluded from the public spec),
// a performance claim nobody verified, and CONTRIBUTING.md (maintainer
// notes, not shipped in the package: a dead reference on npmjs.com).
// `console` is the word, not `console.log()`.
const FORBIDDEN = [
  /contributing\.md/i,
  /sk-/i,
  /console(?!\.)/i,
  /per.deployment/i,
  /plt\./i,
  /gitlab/i,
  /webhook/i,
  /cheap.to.poll/i,
  /signature mismatch/i,
];

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (path.endsWith(".ts") && path !== GENERATED) yield path;
  }
}

function offenders(files: Iterable<string>, patterns: RegExp[]): string[] {
  const found: string[] = [];
  for (const path of files) {
    readFileSync(path, "utf-8")
      .split("\n")
      .forEach((line, i) => {
        if (patterns.some((pattern) => pattern.test(line))) {
          found.push(`${relative(ROOT, path)}:${i + 1}: ${line.trim()}`);
        }
      });
  }
  return found;
}

it("no internal detail in the README or the sources", () => {
  expect(offenders([join(ROOT, "README.md"), ...sources(join(ROOT, "src"))], FORBIDDEN)).toEqual([]);
});

// Beyond the README and the package, every tracked file ends up in the
// public repository: no internal host, repository path or internal document
// there either. The spec and the types generated from it are excluded
// (they're the public API reference), as is this file, which lists the
// patterns.
const FORBIDDEN_ANYWHERE = [/plt\./i, /gitlab\.kardinal/i, /public-docs/i, /guidelines/i, /aropy/i, /sk-[a-z0-9]/i];
const EXCLUDED = new Set(["spec/openapi.yaml", "src/routing/generated-types.ts", "tests/public-text.test.ts"]);

it("no internal detail in any tracked file", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf-8" })
    .split("\n")
    .filter((name) => name && !EXCLUDED.has(name))
    .map((name) => join(ROOT, name))
    .filter((path) => statSync(path, { throwIfNoEntry: false })?.isFile());
  expect(offenders(tracked, FORBIDDEN_ANYWHERE)).toEqual([]);
});

// The README has told users to `npm install @kardinal-ai/sdk commander`
// since the CLI existed, and the JSDoc calls it a peer dependency — while
// package.json listed it under `dependencies`, so it was installed either
// way and the instruction was noise. The intent (the Python SDK's optional
// `[cli]` extra) is now what the manifest says; this keeps the two from
// drifting apart again.
it("commander is optional, as the README and the CLI's JSDoc promise", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  expect(pkg.dependencies).not.toHaveProperty("commander");
  expect(pkg.peerDependencies).toHaveProperty("commander");
  expect(pkg.peerDependenciesMeta.commander.optional).toBe(true);
  // Still installed for the tests, which drive the CLI directly.
  expect(pkg.devDependencies).toHaveProperty("commander");
});
