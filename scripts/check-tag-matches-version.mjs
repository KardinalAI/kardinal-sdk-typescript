// Fail unless a release tag (vX.Y.Z, or vX.Y.Z-dev.N for a pre-release)
// matches the version in package.json. Run by .github/workflows/publish.yml
// before building, so a mistyped tag can't publish a mislabeled release.
//
// Usage: node scripts/check-tag-matches-version.mjs v1.0.0

import { readFileSync } from "node:fs";

const tag = process.argv[2];
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
const expected = `v${version}`;

if (tag !== expected) {
  console.error(
    `Tag ${JSON.stringify(tag)} doesn't match the package version: expected ${JSON.stringify(expected)} ` +
      "(update the version in package.json, or fix the tag).",
  );
  process.exit(1);
}
console.log(`Tag ${JSON.stringify(tag)} matches the package version.`);
