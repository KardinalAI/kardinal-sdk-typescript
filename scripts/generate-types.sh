#!/usr/bin/env bash
# Regenerate src/routing/generated-types.ts from spec/openapi.yaml.
# Never hand-edit the generated file — it's overwritten on every run.
set -euo pipefail
cd "$(dirname "$0")/.."

npx openapi-typescript spec/openapi.yaml --output src/routing/generated-types.ts

echo "Generated src/routing/generated-types.ts"
