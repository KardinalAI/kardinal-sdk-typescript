# Contributing to the Kardinal TypeScript SDK

## Reporting a bug or asking for a change

Open an issue: https://github.com/KardinalAI/kardinal-sdk-typescript/issues.
Include the SDK version (`kardinal version`, or
`npm ls @kardinal-ai/sdk`), your Node.js version, and what you did,
expected and got. Never paste your API key in an issue.

Pull requests are not accepted for now: this GitHub repository is a
read-only mirror of our internal repository, so a pull request opened here
can't be merged. Please open an issue instead.

For questions about your account, credits or quotas, contact
customer.success@kardinal.ai.

## For maintainers

The rest of this file is for the team working on the SDK itself. For using
it, see `README.md`.

### Setup and checks

```bash
npm ci
npm run generate:types   # regenerate src/routing/generated-types.ts
npm run typecheck
npm run build
npm test
```

CI runs the typecheck, the build and the tests on every supported Node.js
version (22, 24 and 26, see `.gitlab-ci.yml`). The tests include
`tests/types-no-diff.test.ts`, which regenerates the types
(`scripts/check-types-no-diff.sh`) and fails if the committed file
changes: `openapi-typescript` is pinned exactly in `package.json` for that
reason.

### Releasing

Releases are staged on npm by `.github/workflows/publish.yml`, on the
GitHub mirror, with Trusted Publishing: no API token is stored anywhere.
The workflow only stages the package; a maintainer approves it before it
goes live.

1. Open a merge request that sets the new `version` in `package.json`
   (`npm version X.Y.Z --no-git-tag-version` updates `package-lock.json`
   too), and merge it.
2. Create the tag `vX.Y.Z` (matching that version) on the source
   repository, on the merged commit. The push mirror copies it to GitHub
   within minutes. Don't create tags on GitHub: the mirror would overwrite
   them.
3. On GitHub, the workflow typechecks, builds, tests, checks that the tag
   matches the package version and packs the tarball, then stages it on
   npm (Actions tab).
4. Approve the staged version on npmjs.com (package page, Staged Packages
   tab) or with `npm stage approve <stage-id>` (`npm stage list
   @kardinal-ai/sdk` gives the id). Both ask for two-factor
   authentication. Once approved, it's live at
   https://www.npmjs.com/package/@kardinal-ai/sdk.

To try the whole chain before a release, set a pre-release version,
`X.Y.Z-dev.N` (for instance `1.0.0-dev.1`), and tag it `vX.Y.Z-dev.N`:
the workflow stages it under the `next` dist-tag, so a plain
`npm install @kardinal-ai/sdk` never installs it. To install one:
`npm install @kardinal-ai/sdk@next`.

npm never accepts the same version twice, and a staged version already
takes its number: bump `N` for every new try.

Unlike the Python SDK, whose dry runs go to TestPyPI, a pre-release here
goes to the real npm registry, kept off `latest` by the `next` dist-tag:
npm has no separate test registry.

### The spec

`spec/openapi.yaml` is a copy of the `openapi.yaml` of the Kardinal API docs,
whose source repository is internal (the published version is at
https://developers.kardinal.ai/openapi.yaml). It isn't fetched at build
time. Maintainers with access to the docs repository check it hasn't
drifted before a release:

```bash
npm run check:spec
```

By default this compares against mintlify's published spec
(`origin/main`, read with `git show` from `../mintlify`, or
`MINTLIFY_REPO_PATH`), without checking anything out there; run
`git -C <mintlify repo> fetch` first to compare against the latest main.
`MINTLIFY_REF` picks another ref, and an explicit file path
(`npm run check:spec -- path/to/openapi.yaml`) is compared as-is. To
resync:

```bash
git -C <mintlify repo> show origin/main:openapi.yaml > spec/openapi.yaml
npm run generate:types
```

Never hand-edit `src/routing/generated-types.ts`: it's overwritten on
every regeneration. Notes on the generated types that the hand-written
layer needs (not the API itself) live in `src/routing/schemas.ts`.

### Code generation notes

- `openapi-typescript` has different codegen defects than the Python SDK's
  `datamodel-codegen`, not the same ones. `items: allOf: [$ref: Stop]` in
  `Order.stops`, which makes `datamodel-codegen` wrap each stop in a
  `Stop1`/`Stop12`/`Stop13` class, makes `openapi-typescript` generate
  `Omit<Stop, "type">[]` instead, silently making the required `type`
  discriminator look absent. Fixed with the hand-written `Order`/`Stop`
  types and schemas in `src/routing/schemas.ts`, not a spec change.
- Fields with a `default:` value are generated as required, not optional
  (`Order.priority`, `Resource.priority`): the opposite of
  `datamodel-codegen`, where a default makes a field optional. The input
  type users write (`PlanCreateInput`, from the Zod schema) keeps them
  optional.
- `src/routing/schemas.ts` validates `orders`, `stops`, `resources` and the
  top-level scalar fields with the same rules as the Python SDK; the nested
  objects of the rarer fields are typed but not deeply validated at
  runtime (see the module's docstring).
- The double-`allOf` chain (`Plan.id -> PlanId -> UUID`) that the Python
  SDK patches in `kardinal/routing/_annotations.py` resolves cleanly here:
  `PlanId` is just `string`.
- The webhook endpoints are marked `x-excluded` in the spec and are not
  implemented by this SDK (their types are still generated).

### Differences with the Python SDK

The two SDKs behave the same; what differs, on purpose or by the nature of
each stack:

- Local validation: this SDK doesn't validate the inside of the rarer
  nested objects (`cost`, `breaks`, `objectives`, constraints, ...), and
  doesn't report a misspelled key there; the Python SDK's generated models
  do both. Zod, here, rejects strings for numbers and booleans (`"1"`,
  `"true"`), which pydantic accepts.
- `update()`'s record of the keys the API sent back: kept on the client,
  keyed on the plan id, so it survives a copy or a JSON round trip (for the
  last 64 plans read). The Python SDK keeps it on the plan object, which a
  `model_dump()`/`model_validate()` round trip loses.
- `update()`'s warning on a likely typo goes to `onWarning` (default
  `console.warn`); the Python SDK raises an `UnknownFieldWarning` through
  `warnings`.
- Timeout: `timeoutMs` covers the whole request, response included;
  `httpx` applies the Python SDK's `timeout` to each phase separately.
- Validation messages (`plans validate`): the wording of pattern, missing
  field and unknown field errors is shared; other messages come from Zod
  here and from pydantic there.
- There's no `close()`: `fetch` has no connection pool of the SDK's own.
- Pre-releases: the npm `next` dist-tag here, TestPyPI there.

### What we don't want

The shape a full SDK generator would produce, which this SDK deliberately
does not reproduce:

```ts
import { getPlan } from "kardinal-client/api/plan"; // one import per endpoint
const result = await getPlan({ path: { id: "p1" }, client }); // error returned, not thrown
// -> { data?: EnvelopedPlan; error?: EnvelopedErrors }: untangle it on every call
```

