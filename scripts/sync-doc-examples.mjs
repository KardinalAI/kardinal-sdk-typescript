// Copies the ```ts blocks of the Kardinal API docs pages into
// tests/doc-examples/, where tests/doc-examples.test.ts compiles and runs
// them against a mocked API. The pages live in the docs repository
// (`../mintlify` by default), which the CI runner cannot read: the copy is
// what CI runs, and this script refreshes it.
//
// Like scripts/check-spec-matches-mintlify.mjs, it reads the pages with
// `git show` at a ref (`origin/main` by default), never from the working
// tree, which may hold unmerged doc work. Nothing is checked out or fetched
// there: run `git -C <mintlify> fetch` first for the latest main.
//
//   npm run sync:doc-examples             rewrite tests/doc-examples/
//   npm run sync:doc-examples -- --check  exit 1 if the copy differs
//
//   MINTLIFY_REPO_PATH=/path/to/mintlify MINTLIFY_REF=origin/main npm run sync:doc-examples
//
// Run `--check` before each release, like the spec check.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = `${root}tests/doc-examples`;

// Pages covered: sdks/**/*.mdx and guides/*.mdx.
const PAGE = /^(sdks\/.+|guides\/[^/]+)\.mdx$/;

// Every skip is printed, never silent. Only ```ts and ```typescript fences are
// copied; ```bash, ```json and the other languages never are.
const SKIPPED_PAGES = {
  "sdks/python/changelog.mdx": "Python SDK page",
  "sdks/python/reference.mdx": "Python SDK page",
  "sdks/typescript/changelog.mdx": "changelog page",
  "sdks/typescript/reference.mdx": "signatures, not runnable code",
};

const FENCE = /^(?<indent>[ \t]*)```(?:ts|typescript)(?:[ \t].*)?$/;

function git(repo, ...args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    console.error(`git ${args.join(" ")} failed in ${repo}: ${String(error.stderr ?? error.message).trim()}`);
    process.exit(2);
  }
}

// Yields [line number of the opening fence, code] for each ts block.
function* blocks(text) {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const match = FENCE.exec(lines[i]);
    if (!match) {
      i += 1;
      continue;
    }
    const indent = match.groups.indent;
    const start = i + 1;
    const body = [];
    i += 1;
    while (i < lines.length && lines[i].trim() !== "```") {
      body.push(lines[i].startsWith(indent) ? lines[i].slice(indent.length) : lines[i]);
      i += 1;
    }
    yield [start, body.join("\n") + "\n"];
    i += 1;
  }
}

// The expected content of tests/doc-examples/, as { file name: text }.
function build(repo, ref) {
  const files = {};
  const pages = git(repo, "ls-tree", "-r", "--name-only", ref)
    .split("\n")
    .filter((p) => PAGE.test(p))
    .sort();
  for (const page of pages) {
    if (page in SKIPPED_PAGES) {
      console.error(`skipped ${page}: ${SKIPPED_PAGES[page]}`);
      continue;
    }
    const parts = [...blocks(git(repo, "show", `${ref}:${page}`))].map(
      ([line, code]) => `// --- ${page}:${line}\n${code}`,
    );
    if (parts.length) {
      const header = `// Copied from ${page} by scripts/sync-doc-examples.mjs: do not edit by hand.\n\n`;
      files[page.replace(/\.mdx$/, "").replaceAll("/", "__") + ".ts"] = header + parts.join("\n\n");
    }
  }
  return files;
}

const repo = process.env.MINTLIFY_REPO_PATH || `${root}../mintlify`;
const ref = process.env.MINTLIFY_REF || "origin/main";
const expected = build(repo, ref);
const present = {};
if (existsSync(out)) {
  for (const name of readdirSync(out)) if (name.endsWith(".ts")) present[name] = readFileSync(`${out}/${name}`, "utf-8");
}

if (process.argv.includes("--check")) {
  const drift = [...new Set([...Object.keys(expected), ...Object.keys(present)])]
    .filter((name) => expected[name] !== present[name])
    .sort();
  if (!drift.length) {
    console.log(`tests/doc-examples/ matches the doc pages at ${ref} in ${repo}.`);
    process.exit(0);
  }
  console.log(`tests/doc-examples/ has drifted from the doc pages at ${ref} in ${repo}: ${drift.join(", ")}`);
  console.log("Run: npm run sync:doc-examples");
  process.exit(1);
}

mkdirSync(out, { recursive: true });
for (const name of Object.keys(present)) if (!(name in expected)) unlinkSync(`${out}/${name}`);
for (const [name, text] of Object.entries(expected)) writeFileSync(`${out}/${name}`, text);
console.log(`Wrote ${Object.keys(expected).length} files to tests/doc-examples/ from ${ref} in ${repo}.`);
