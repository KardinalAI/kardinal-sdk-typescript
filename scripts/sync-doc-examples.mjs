// Copies the ```ts blocks of the Kardinal API docs pages into
// tests/doc-examples/, where tests/doc-examples.test.ts compiles and runs
// them against a mocked API. It also copies the "Full payload" JSON block of
// two case-study pages into tests/case-studies/, which tests/examples.test.ts
// compares the example plans with. The pages live in the docs repository
// (`../mintlify` by default), which the CI runner cannot read: the copy is
// what CI runs, and this script refreshes it.
//
// Like scripts/check-spec-matches-mintlify.mjs, it reads the pages with
// `git show` at a ref (`origin/main` by default), never from the working
// tree, which may hold unmerged doc work. Nothing is checked out or fetched
// there: run `git -C <mintlify> fetch` first for the latest main.
//
//   npm run sync:doc-examples             rewrite tests/doc-examples/ and tests/case-studies/
//   npm run sync:doc-examples -- --check  exit 1 if a copy differs
//
//   MINTLIFY_REPO_PATH=/path/to/mintlify MINTLIFY_REF=origin/main npm run sync:doc-examples
//
// Run `--check` before each release, like the spec check.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = `${root}tests/doc-examples`;
const caseStudiesOut = `${root}tests/case-studies`;

// Case-study pages whose "Full payload" block is copied, as { page: file stem }.
const CASE_STUDIES = {
  "case-studies/cold-chain-last-mile.mdx": "cold-chain-last-mile",
  "case-studies/parcel-express.mdx": "parcel-express",
};

// Pages covered: sdks/**/*.mdx and guides/*.mdx.
const PAGE = /^(sdks\/.+|guides\/[^/]+)\.mdx$/;

// Every skip is printed, never silent. Only ```ts and ```typescript fences are
// copied; ```bash, ```json and the other languages never are. The one
// exception is the "Full payload" block of the CASE_STUDIES pages.
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

// The first ```json block after the "Full payload" accordion of a page. It is
// picked by its title, not by position: a JSON block added earlier on the page
// must not change what is copied. Throws a message that names the page.
export function fullPayload(page, text) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.includes('<Accordion title="Full payload'));
  if (start === -1) {
    throw new Error(`${page}: no <Accordion title="Full payload ..."> found. Fix the page, or update CASE_STUDIES here.`);
  }
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].includes("</Accordion>")) break;
    if (lines[i].trim() !== "```json") continue;
    const body = [];
    for (const line of lines.slice(i + 1)) {
      if (line.trim() === "```") {
        const code = body.join("\n") + "\n";
        try {
          JSON.parse(code);
        } catch (error) {
          throw new Error(`${page}: the Full payload block is not valid JSON (${error.message}).`);
        }
        return code;
      }
      body.push(line);
    }
  }
  throw new Error(`${page}: no \`\`\`json block after the Full payload accordion.`);
}

// The expected content of tests/case-studies/, as { file name: text }.
function buildCaseStudies(repo, ref) {
  return Object.fromEntries(
    Object.entries(CASE_STUDIES).map(([page, slug]) => [`${slug}.json`, fullPayload(page, git(repo, "show", `${ref}:${page}`))]),
  );
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

function main() {
  const repo = process.env.MINTLIFY_REPO_PATH || `${root}../mintlify`;
  const ref = process.env.MINTLIFY_REF || "origin/main";
  const folders = [
    [out, ".ts", build(repo, ref)],
    [caseStudiesOut, ".json", buildCaseStudies(repo, ref)],
  ].map(([dir, extension, expected]) => {
    const present = {};
    if (existsSync(dir)) {
      for (const name of readdirSync(dir)) if (name.endsWith(extension)) present[name] = readFileSync(`${dir}/${name}`, "utf-8");
    }
    return { dir, expected, present };
  });

  if (process.argv.includes("--check")) {
    const drift = folders.flatMap(({ dir, expected, present }) =>
      [...new Set([...Object.keys(expected), ...Object.keys(present)])]
        .filter((name) => expected[name] !== present[name])
        .map((name) => `${dir.slice(root.length)}/${name}`),
    );
    if (!drift.length) {
      console.log(`tests/doc-examples/ and tests/case-studies/ match the doc pages at ${ref} in ${repo}.`);
      process.exit(0);
    }
    console.log(`The copies have drifted from the doc pages at ${ref} in ${repo}: ${drift.sort().join(", ")}`);
    console.log("Run: npm run sync:doc-examples");
    process.exit(1);
  }

  for (const { dir, expected, present } of folders) {
    mkdirSync(dir, { recursive: true });
    for (const name of Object.keys(present)) if (!(name in expected)) unlinkSync(`${dir}/${name}`);
    for (const [name, text] of Object.entries(expected)) writeFileSync(`${dir}/${name}`, text);
    console.log(`Wrote ${Object.keys(expected).length} files to ${dir.slice(root.length)}/ from ${ref} in ${repo}.`);
  }
}

// Importing this file (the test does, for fullPayload) must not run it. Node
// resolves symlinks in import.meta.url but not in argv[1], so compare real paths.
if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
