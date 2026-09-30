#!/usr/bin/env bash
# Regenerate src/routing/generated-types.ts from spec/openapi.yaml.
# Never hand-edit the generated file — it's overwritten on every run.
#
# Runs the locally installed openapi-typescript, whose version is pinned
# exactly in package.json: another version may generate different output,
# which would make the "types regenerate with no diff" check
# (tests/types-no-diff.test.ts) fail regardless of the spec.
set -euo pipefail
cd "$(dirname "$0")/.."

npx --no-install openapi-typescript spec/openapi.yaml --output src/routing/generated-types.ts

echo "Generated src/routing/generated-types.ts"
