# kardinal (TypeScript)

TypeScript SDK for the Kardinal route-optimization API: submit a plan,
follow its optimization, retrieve the solution, update it to re-optimize.

```bash
npm install @kardinal-ai/sdk                 # library only
npm install @kardinal-ai/sdk commander       # + the `kardinal` command
```

Node.js >= 22.

## Quickstart

```ts
import { Kardinal, examples } from "@kardinal-ai/sdk";

const k = new Kardinal(); // reads KARDINAL_API_KEY
const plan = await k.routing.plans.submit(examples.smallDeliveryPlan());
const solution = await k.routing.solutions.wait(plan.id); // returns in ~10s
```

`wait`, not `get`, on purpose: the API is asynchronous, and a `get` called
right after `submit` returns an empty-but-valid solution. Reaching for
`wait` first avoids that trap.

## Full walkthrough

```ts
import { Kardinal, KardinalValidationError } from "@kardinal-ai/sdk";
import { parsePlanCreate } from "@kardinal-ai/sdk";

const k = new Kardinal({ timeoutMs: 30_000, maxRetries: 3 });

const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
const dateStr = tomorrow.toISOString().slice(0, 10);

const planInput = parsePlanCreate({
  tz: "Europe/Paris",
  maxOptimizationDuration: "PT5M",
  resources: [
    {
      id: "truck-1",
      vehicleProfile: { type: "car" },
      workingTimeWindow: { begin: `${dateStr}T08:00:00+01:00`, end: `${dateStr}T18:00:00+01:00` },
    },
  ],
  orders: [
    {
      id: "order-1",
      stops: [{ type: "single", id: "stop-1", position: { lat: 48.8566, lon: 2.3522 } }],
    },
  ],
});

let plan;
try {
  plan = await k.routing.plans.submit(planInput); // the server assigns `id`
} catch (e) {
  if (e instanceof KardinalValidationError) {
    console.log(e.code); // INVALID_VALUE, ID_NOT_UNIQUE, ...
    console.log(e.errors); // every error, not just the first
  }
  throw e;
}

const solution = await k.routing.solutions.wait(plan.id); // resolves once it's done
console.log(solution.finalState); // "optimized", or "interrupted"/"stopped" if cut short
for (const tour of solution.tours ?? []) {
  console.log(tour.resourceId, tour.wayPoints?.length);
}

// manual tracking instead of a blocking wait
const objectives = await k.routing.solutions.getObjectives(plan.id); // cheap to poll
const status = await k.routing.plans.getStatus(plan.id);

// re-optimize: same id, the version increments on its own
plan.orders = [
  ...(plan.orders ?? []),
  { id: "order-2", priority: 0, stops: [{ type: "single", id: "stop-2", position: { lat: 48.86, lon: 2.35 } }] },
];
const updated = await k.routing.plans.update(plan);
```

Note on stops: openapi.yaml has no top-level `Plan.stops` — stops live
inside `Order.stops[]`, and `Plan.orders[]` is the array of orders. An
`Order` groups one or more stops that must be planned onto the same
resource (for example a pickup and its delivery).

## Errors

```
KardinalError
├── KardinalAuthError           NOT_AUTHENTICATED (401): missing, invalid or expired key
├── KardinalLimitError          any 403 (NOT_ALLOWED): plan-size limit, optimization quota,
│                               or insufficient credits
├── KardinalValidationError     the 7 codes under 400, with the full error list
├── KardinalNotFoundError       NOT_FOUND — raised on every 404, including reads
├── KardinalRateLimitError      429: temporary overload, retry after a pause
├── KardinalServerError         INTERNAL_SERVER_ERROR, or any other 5xx
├── KardinalTimeoutError        solutions.wait()'s hard timeout elapsed
├── KardinalOptimizationError   solutions.wait() has no solution to return: NO_SOLUTION,
│                               PLAN_SUPERSEDED, OPTIMIZATION_STALLED (engine crashed)
└── KardinalConnectionError     DNS/connection/fetch failure, no HTTP response at all
```

Every error carries `.code`, `.status`, `.requestId`, `.retryable`,
`.warnings`, `.errors` and `.details`. `.errors` is every error object of
the response; `.details` is the `properties.details` of the error `.code`
came from, the only way to tell apart errors that share a code.

`KardinalLimitError` is what every 403 becomes: for a builder account, a
403 always means a limit was hit, never a permission refusal. `.details`
says which one. For a plan-size limit, `.errors` also holds an
`INVALID_VALUE` entry whose `properties.path` and `properties.details`
name the field and the allowed value.

`.retryable` is computed by the SDK and means "retrying is safe and may
succeed": true for a `429`, and for a `5xx` or a connection error, except
when a `submit()` may have reached the server (the plan may then already
exist: check with `list()` before submitting again). An unrecognized `code`
falls back to the family matching the HTTP status rather than disappearing,
since the spec documents that new codes may be added in a non-breaking
release.

## The CLI

```
kardinal auth check                    confirms the API key and its agency
kardinal version

kardinal routing plans submit <file> | get <id> | update <file> | delete <id>
kardinal routing plans list | start <id> | stop <id> | status <id>
kardinal routing plans validate <file> local only, no API call, no credits
kardinal routing solutions get <id> | objectives <id> | wait <id>

kardinal routing demo                  submits the example plan, waits for it
kardinal init                          drops a skill pointer into the project
```

JSON output when stdout isn't a terminal, or with `--json`; a readable
table otherwise. The API key is read only from `KARDINAL_API_KEY` — never
accepted as a flag.

Kardinal has more than one environment (production, plus separate hosts
per deployment), each with its own signing keys — a token only
authenticates against the host matching whatever console issued it, or
fails with a generic-looking auth error that doesn't say so. Point the CLI
(or a plain `new Kardinal()` call) at a non-production host with
`KARDINAL_BASE_URL`. When the key works, `kardinal auth check` prints the
active host (`baseUrl`) and the agency the key resolves to; when it
doesn't, it prints only the error (`code`, `message`, `retryable`), not the host.

`commander` (the CLI's argument parser) is a peer dependency, not a hard
one — `npm install @kardinal-ai/sdk` alone doesn't pull it in; `kardinal` the
command needs `commander` installed alongside it.

## Known gaps

This SDK is generated against openapi.yaml as it stands, ported from the
lessons of the Python sibling SDK (`kardinal-sdk-python`) — most of its
"known gaps" apply here too (no `Idempotency-Key`, no request-id header,
`getStatus()`/`getObjectives()` naming not matching the spec's own
inconsistent naming). A few are specific to this stack:

- **`openapi-typescript` has different codegen defects than
  `datamodel-codegen`, not the same ones.** The Python SDK's
  `Stop1`/`Stop11`/`Stop12` wrapper-class mess (from `items: allOf:
  [$ref: Stop]` in `Order.stops`) doesn't happen here — but the same spec
  pattern makes `openapi-typescript` generate `Omit<Stop, "type">[]`,
  silently making the required `type` discriminator look optional/absent.
  Fixed the same way: a hand-written `Order`/`Stop` type in
  `src/routing/schemas.ts`, not a spec change.
- **Fields with a `default:` value are generated as required, not
  optional** (`Order.priority`, `Resource.priority`) — the opposite of
  `datamodel-codegen`'s behavior on the Python side, where a default makes
  a field `Optional`. Something to know if porting example code between
  the two SDKs.
- **Not deeply validated yet**: `resources` only checks the fields
  openapi.yaml actually marks required (`id`, `vehicleProfile`,
  `workingTimeWindow`); the rarer plan-level fields
  (`additionalConstraints`, `globalConstraints`, `objectives`, and the
  `*ByResourceTag`/`*ByStopTag` maps) are typed for compile-time safety but
  not runtime-validated the way the Python SDK's fully pydantic-backed
  models are. A malformed value there fails server-side (400), not
  locally, in this version.
- **The `PlanId`/UUID double-`allOf` chain that broke pydantic-generated
  models on the Python side resolves cleanly here** (`PlanId` is just
  `string`) — TypeScript's structural type system doesn't need the same
  per-hop resolution pydantic's class generation does.
- **`User-Agent` is sent, but browsers may silently drop or ignore it**
  (a "forbidden header name" in some fetch implementations) — this SDK
  targets Node.js; browser behavior isn't verified.

Verified live against a sandbox environment: `auth check`, and a full
`submit` → `wait` → `getStatus` → `delete` cycle.

## Development

See `CONTRIBUTING.md`: setup, checks, the spec and releasing.
