// Structural comparison of spec/openapi.yaml against the openapi.yaml of the
// Kardinal API docs repository (checked out next to this one, `../mintlify`
// by default), which is the source of truth this SDK's spec is copied from.
//
// A raw `diff` on these two YAML files is misleading: property reordering
// between regenerations produces large, unreadable hunks even when nothing
// meaningful changed. Comparing the parsed structure instead reports only
// real additions/removals.
//
// Not wired into CI: the CI runner has no access to the docs repository.
// Run it by hand before a release, or whenever the docs' openapi.yaml
// changes: `npm run check:spec [-- path/to/openapi.yaml]`.
//
// By default, compares against the docs' *published* spec (`origin/main`),
// read with `git show` — not the working-tree file, which reflects whatever
// branch happens to be checked out there. Nothing is checked out or fetched
// in the docs repository: run `git -C <docs repo> fetch` first to compare
// against the latest main. MINTLIFY_REPO_PATH and MINTLIFY_REF pick another
// repository or ref; an explicit file path as argument is compared as-is.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const root = fileURLToPath(new URL("..", import.meta.url));

let docsSpec;
if (process.argv[2]) {
  if (!existsSync(process.argv[2])) {
    console.error(`Can't find ${process.argv[2]}.`);
    process.exit(2);
  }
  docsSpec = readFileSync(process.argv[2], "utf-8");
} else {
  const repo = process.env.MINTLIFY_REPO_PATH || `${root}../mintlify`;
  const ref = process.env.MINTLIFY_REF || "origin/main";
  try {
    docsSpec = execFileSync("git", ["-C", repo, "show", `${ref}:openapi.yaml`], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    console.error(`Can't read openapi.yaml at ${ref} in ${repo}.`);
    console.error("Usage: npm run check:spec [-- path/to/openapi.yaml]");
    console.error("   or: MINTLIFY_REPO_PATH=/path/to/mintlify MINTLIFY_REF=origin/main npm run check:spec");
    process.exit(2);
  }
  console.error(`Comparing against ${repo} at ${ref}.`);
}

const kind = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

function diff(a, b, path = "") {
  if (kind(a) !== kind(b)) return [[path, "type", a, b]];
  if (kind(a) === "object") {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((k) => {
      const p = path ? `${path}.${k}` : k;
      if (!(k in a)) return [[p, "only_in_mintlify"]];
      if (!(k in b)) return [[p, "only_in_sdk"]];
      return diff(a[k], b[k], p);
    });
  }
  if (kind(a) === "array") {
    const found = a.length !== b.length ? [[path, "list_len", a.length, b.length]] : [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) found.push(...diff(a[i], b[i], `${path}[${i}]`));
    return found;
  }
  return a === b ? [] : [[path, "value", a, b]];
}

const findings = diff(yaml.load(readFileSync(`${root}spec/openapi.yaml`, "utf-8")), yaml.load(docsSpec));
if (findings.length === 0) {
  console.log("spec/openapi.yaml matches the mintlify repo's openapi.yaml.");
  process.exit(0);
}
console.log(`spec/openapi.yaml has drifted from mintlify: ${findings.length} structural difference(s).`);
for (const [p, what, sdk, docs] of findings) {
  if (what === "only_in_sdk" || what === "only_in_mintlify") console.log(`  ${what}: ${p}`);
  else console.log(`  ${what} at ${p}: sdk=${JSON.stringify(sdk)} mintlify=${JSON.stringify(docs)}`);
}
console.log();
console.log(
  "Run: git -C <mintlify repo> show origin/main:openapi.yaml > spec/openapi.yaml && npm run generate:types"
);
process.exit(1);
