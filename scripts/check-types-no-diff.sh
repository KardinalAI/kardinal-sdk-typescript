#!/usr/bin/env bash
# CI check: regenerating the types must produce no diff. Regenerates in
# place and fails if the committed file changed.
set -euo pipefail
cd "$(dirname "$0")/.."

TYPES=src/routing/generated-types.ts

bash scripts/generate-types.sh >/dev/null

if ! git diff --quiet -- "$TYPES"; then
  echo "$TYPES is out of date with spec/openapi.yaml." >&2
  echo "Run npm run generate:types and commit the result." >&2
  git diff -- "$TYPES" >&2
  exit 1
fi

echo "Types are up to date."
