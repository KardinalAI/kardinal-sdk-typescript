/**
 * Hand-written request models `openapi-typescript`'s pure type generation
 * can't provide on its own: openapi.yaml has only one `Plan` schema, shared
 * by requests and responses, so `PlanCreate` (Plan minus every
 * server-assigned field) is written by hand here — plus runtime validation
 * via Zod, since plain generated types disappear at compile time and give
 * no equivalent to the Python sibling SDK's pydantic-backed `plans
 * validate` (reject a malformed plan before spending credits, with the
 * full list of problems, not just the first).
 *
 * Scope: `orders`/`stops`, `resources` and the top-level scalar fields are
 * validated below with the same rules as the Python SDK (id pattern, ISO
 * 8601 duration pattern, integers, required fields). The nested objects of
 * the rarer fields (`cost`, `breaks`, vehicle profile options on a
 * resource; `additionalConstraints`, `globalConstraints`, `objectives` and
 * the other `*ByResourceTag`/`*ByStopTag` maps on a plan) are typed for
 * compile-time safety via the generated schema types, but not deeply
 * validated at runtime — a malformed value there fails server-side (400),
 * not locally.
 */

import { z } from "zod";
import { UnknownFieldError } from "../core/errors.js";
import type { components } from "./generated-types.js";

// --- Scalars (openapi.yaml `RegexIdValidation`, `Duration`) ----------------

// Same wording as the Python SDK's validation errors.
const matching = (pattern: RegExp) =>
  z.string().regex(pattern, { message: `String should match pattern '${pattern.source}'` });
const idSchema = matching(/^[a-zA-Z0-9-._~:@!$,]+$/);
const durationSchema = matching(/^P(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(\d+H)?(\d+M)?(\d+S)?)?$/);

// --- Position / TimeWindow / TaggedTimeWindow -----------------------------

// `passthrough` throughout, like every other request schema: a key these
// kept out would be reported by `unknownFields` and then dropped here, so
// `allowUnknown` would have removed in silence exactly what it was asked to
// send.
const positionSchema = z
  .object({
    lon: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
  })
  .passthrough();

const timeWindowSchema = z
  .object({
    begin: z.string(),
    end: z.string(),
  })
  .passthrough();

const taggedTimeWindowSchema = z
  .object({
    begin: z.string(),
    end: z.string(),
    resourceTags: z.array(idSchema).optional(),
  })
  .passthrough();

/** `maxInterStopDistanceInKm` / `maxInterStopDuration`: a scalar applied to
 * every travel, or a bound per segment. Spelled out rather than left as an
 * opaque value, so a typo inside the object form is reported like any
 * other — each key is independent, and an absent one means no constraint on
 * that segment rather than a constraint of zero. */
const segmentBoundsSchema = <T extends z.ZodTypeAny>(bound: T) =>
  z
    .object({
      firstTravel: bound.optional(),
      interStop: bound.optional(),
      lastTravel: bound.optional(),
    })
    .passthrough();

const capacitiesSchema = z.record(z.string(), z.number());

// --- Stops ------------------------------------------------------------------
// Runtime counterpart of the generated `Stop` union: the generated types
// vanish at compile time, and a plan built from JSON or from untyped data
// has to be checked somewhere. Until the spec dropped its redundant
// `allOf` wrappers, this also had to repair the generated type, which came
// out as `Omit<Stop, "type">[]` with the required discriminator stripped;
// the generated type is now correct on its own and this only validates.

const singleStopSchema = z.object({
  type: z.literal("single"),
  id: idSchema,
  properties: z.record(z.string(), z.string()).optional(),
  tags: z.array(idSchema).optional(),
  position: positionSchema,
  kind: z.enum(["pickup", "delivery", "acknowledgement"]).optional(),
  operationDuration: durationSchema.optional(),
  capacities: capacitiesSchema.optional(),
  authorizedTimeWindows: z.array(taggedTimeWindowSchema).optional(),
  preferredTimeWindows: z.array(taggedTimeWindowSchema).optional(),
}).passthrough();

const alternativesStopSchema = z
  .object({
    id: idSchema,
    type: z.literal("alternatives"),
    alternatives: z.array(singleStopSchema),
  })
  .passthrough();

const stopSchema = z.union([singleStopSchema, alternativesStopSchema]);

export type SingleStop = z.infer<typeof singleStopSchema>;
export type AlternativesStop = z.infer<typeof alternativesStopSchema>;
export type Stop = z.infer<typeof stopSchema>;

// --- Order --------------------------------------------------------------

export const orderSchema = z
  .object({
    id: idSchema,
    properties: z.record(z.string(), z.string()).optional(),
    priority: z.number().int().default(0),
    optional: z.boolean().optional(),
    requiredSkills: z.array(idSchema).optional(),
    stops: z.array(stopSchema),
    successiveStops: z.boolean().optional(),
    maxStopSpan: durationSchema.optional(),
  })
  .passthrough();

export type Order = z.infer<typeof orderSchema>;

// --- Resource / VehicleProfile ---------------------------------------------
// Every field of openapi.yaml's `Resource` is listed, and the schema keeps
// what it doesn't know rather than quietly removing it, so `unknownFields`
// can report it: most fields here are optional, so a misspelled one would
// otherwise vanish and the plan be optimized without it. The nested objects
// of the rarer fields are still not deeply validated (see module
// docstring), and a typo inside one of those is not reported.

export type Resource = components["schemas"]["Resource"];
const resourceSchema = z.object({
  id: idSchema,
  properties: z.record(z.string(), z.string()).optional(),
  state: z.custom<unknown>().optional(),
  cost: z.custom<unknown>().optional(),
  CO2EmissionCalculation: z.custom<unknown>().optional(),
  priority: z.number().int().default(0),
  skills: z.array(idSchema).optional(),
  preferredStopTags: z.array(idSchema).optional(),
  tags: z.array(idSchema).optional(),
  vehicleProfile: z
    .object({ type: z.enum(["fly", "pedestrian", "bicycle", "scooter", "motorbike", "car", "truck"]) })
    .passthrough(),
  capacities: capacitiesSchema.optional(),
  departure: positionSchema.optional(),
  arrival: z.union([positionSchema, z.literal("atFirstPosition")]).optional(),
  workingTimeWindow: timeWindowSchema,
  maxWorkingDuration: durationSchema.optional(),
  maxDistanceInKm: z.number().optional(),
  maxInterStopDistanceInKm: z.union([z.number(), segmentBoundsSchema(z.number())]).optional(),
  maxInterStopDuration: z.union([durationSchema, segmentBoundsSchema(durationSchema)]).optional(),
  breaks: z.array(z.custom<unknown>()).optional(),
  operationDurationPolicies: z.array(z.custom<unknown>()).optional(),
  travelTimeCoefficient: z.number().optional(),
  emptyThresholdByCapacity: capacitiesSchema.optional(),
  avoidEarlyLoadings: z.array(z.custom<unknown>()).optional(),
}).passthrough() as unknown as z.ZodType<Resource>;

// --- PlanCreate -----------------------------------------------------------

export const planCreateSchema = z
  .object({
    properties: z.record(z.string(), z.string()).optional(),
    resources: z.array(resourceSchema),
    orders: z.array(orderSchema).optional(),
    additionalOperationDurations: z.array(z.custom<unknown>()).optional(),
    operationDurationPoliciesByResourceTag: z.record(z.string(), z.custom<unknown>()).optional(),
    additionalConstraints: z.array(z.custom<unknown>()).optional(),
    globalConstraints: z.array(z.custom<unknown>()).optional(),
    accessDurationsByStopTag: z.record(z.string(), durationSchema).optional(),
    overlappingCapacitiesByStopTag: z.record(z.string(), z.number().int()).optional(),
    setupDurations: z.array(z.custom<unknown>()).optional(),
    objectives: z.custom<unknown>().optional(),
    maxOptimizationDuration: durationSchema.optional(),
    tz: z.string().optional(),
    lateDeparture: z.boolean().default(false),
    sharedCapacities: z.boolean().default(false),
    emptyThresholdByCapacityByResourceTag: z.record(z.string(), capacitiesSchema).optional(),
    avoidEarlyLoadingsByResourceTag: z.record(z.string(), z.array(z.custom<unknown>())).optional(),
    CO2EmissionCalculationByResourceTag: z.record(z.string(), z.custom<unknown>()).optional(),
  })
  .passthrough();

export type PlanCreateInput = z.input<typeof planCreateSchema>;
export type PlanCreate = z.infer<typeof planCreateSchema>;


// --- Unknown fields ---------------------------------------------------------
// Most plan fields are optional, so a misspelled one used to be removed in
// silence — by this SDK, then by the API, which drops any key it doesn't
// know. The field it was meant to set stayed unset and the plan came back
// valid. The request schemas above keep such a key instead of dropping it,
// and the walker below finds it by comparing the value against the schema,
// turning it into a path and, where the name is close enough, a
// suggestion.

/** Levenshtein distance, answered only up to `limit`. */
function withinEdits(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current.push(
        a[i - 1] === b[j - 1]
          ? previous[j - 1]
          : 1 + Math.min(previous[j - 1], previous[j], current[j - 1]),
      );
    }
    if (Math.min(...current) > limit) return false;
    previous = current;
  }
  return previous[b.length] <= limit;
}

/** A declared field close enough to `key` to be what was meant. Two edits,
 * but only one on a short name: two edits on a two-letter field is a
 * different word, not a slip. */
function suggestionFor(key: string, known: readonly string[]): string | undefined {
  const near = known
    .filter((field) => withinEdits(key, field, Math.min(key.length, field.length) >= 5 ? 2 : 1))
    .sort((a, b) => Number(a.length !== key.length) - Number(b.length !== key.length));
  return near[0];
}

// NOTE FOR A ZOD 4 UPGRADE: the three helpers below read Zod's internals —
// `_def.innerType`, `_def.schema`, `_def.options`, `_def.type`, `_def.shape()`
// — none of which is public API. Zod 4 renames them and drops
// `.passthrough()` in favour of `z.looseObject`, so this section has to be
// rewritten, not merely bumped. The `^3` range in package.json keeps that
// from happening by accident.

/** Looks through the wrappers Zod puts around a schema (optional, default,
 * nullable) to the object or array underneath. */
function unwrap(node: any): any {
  for (let i = 0; i < 10 && node; i++) {
    if (node?._def?.innerType) node = node._def.innerType;
    else if (node?._def?.schema) node = node._def.schema;
    else return node;
  }
  return node;
}

function shapeOf(node: any): Record<string, any> | undefined {
  const inner = unwrap(node);
  const shape = inner?.shape ?? inner?._def?.shape?.();
  return shape && typeof shape === "object" ? shape : undefined;
}

/** For a union, the branch whose discriminator matches the value — so a
 * stop reports against `single` or `alternatives`, not both. */
function branchFor(node: any, value: Record<string, unknown>): any {
  const options = unwrap(node)?._def?.options;
  if (!Array.isArray(options)) return node;
  const shaped = options.filter((option: any) => shapeOf(option) !== undefined);
  // Only a branch with a shape can describe an object. Without this, a union
  // that lists a literal first (`"atFirstPosition" | Position`) resolved to
  // the literal, found no shape, and reported nothing.
  const discriminated = shaped.find(
    (option: any) => shapeOf(option)?.type?._def?.value === value.type,
  );
  return discriminated ?? shaped[0] ?? options[0];
}

export type UnknownField = { path: string; key: string; suggestion?: string };

/** Every key the request schemas don't declare, with its path — e.g.
 * `plan.resources[0].maxWorkingDurationn` — and, when the name is close to a
 * declared one, what it was probably meant to be. Empty on a clean plan.
 *
 * Walks the value against the schema rather than reading Zod's own report,
 * so the schemas can keep unknown keys (`passthrough`) instead of rejecting
 * them: `submit()` decides what to do with them, and `update()` needs the
 * ones the server sent to survive and be sent back.
 */
export function unknownFields(
  data: unknown,
  schema: z.ZodTypeAny = planCreateSchema,
  path = "plan",
): UnknownField[] {
  if (Array.isArray(data)) {
    const element = unwrap(schema)?._def?.type ?? unwrap(schema)?.element;
    return data.flatMap((item, index) => unknownFields(item, element, `${path}[${index}]`));
  }
  if (data === null || typeof data !== "object") return [];

  const value = data as Record<string, unknown>;
  const shape = shapeOf(branchFor(schema, value));
  if (!shape) return []; // free-form map, or a field left unvalidated on purpose

  const known = Object.keys(shape);
  const found: UnknownField[] = [];
  for (const key of Object.keys(value)) {
    if (key in shape) found.push(...unknownFields(value[key], shape[key], `${path}.${key}`));
    else found.push({ path: `${path}.${key}`, key, suggestion: suggestionFor(key, known) });
  }
  return found;
}

/** Parses and validates a `PlanCreate`, reporting every problem found, not
 * just the first: a `ZodError` for a malformed value, and an
 * `UnknownFieldError` for a key no schema declares — the misspelled field
 * that would otherwise be dropped here and then by the API.
 *
 * `allowUnknown` names keys to let through, for a field the API gained
 * after this SDK version.
 */
export function parsePlanCreate(data: unknown, allowUnknown: string[] = []): PlanCreate {
  const parsed = planCreateSchema.parse(data);
  const allowed = new Set(allowUnknown);
  const unknown = unknownFields(data).filter((field) => !allowed.has(field.key));
  if (unknown.length > 0) throw new UnknownFieldError(unknown);
  return parsed;
}

// --- Plan (response / update) -----------------------------------------------
// Same shape as the generated `Plan`, with `id` narrowed to required (every
// `Plan` this SDK hands back came from the server and always has one) and
// `orders` retyped to the hand-written `Order` above — the generated
// `Plan.orders` inherits the same broken `Stop` typing `Order.stops` has.

// `warnings` isn't a field of the plan at all: it's a sibling of `item` on
// the `EnvelopedPlan` envelope. `submit`/`get`/`update` copy it across so
// callers get the server's amendments (traffic turned off, a value clamped,
// ...) on the object they already have. `update()` never sends it back.
// A plan as read back from the server (e.g. a file saved from `plans get`,
// for `kardinal routing plans update`): same rules as `PlanCreate`, plus a
// required `id`, and unknown fields kept rather than rejected — `update()`
// replaces the whole plan, so dropping one would delete it on the server.
export const planSchema = planCreateSchema
  .extend({
    id: z.string(),
    orders: z.array(orderSchema.passthrough()).optional(),
    // Server-computed, and declared here so they are not mistaken for
    // unknown keys: a plan read by `get()` carries them, and `update()`
    // strips them from the body rather than echoing them back.
    agencyId: z.string().optional(),
    version: z.number().optional(),
    running: z.boolean().optional(),
    status: z.custom<unknown>().optional(),
    state: z.custom<unknown>().optional(),
    nbResources: z.number().optional(),
    nbOrders: z.number().optional(),
    createdAt: z.string().optional(),
    createdBy: z.string().optional(),
    updatedAt: z.string().optional(),
    updatedBy: z.string().optional(),
    archivedAt: z.string().optional(),
    // This SDK's own field (see `Plan`), carried on the object, never sent.
    warnings: z.array(z.custom<unknown>()).optional(),
  })
  .passthrough();

/** Parses and validates a `Plan` (see `parsePlanCreate`), keeping unknown
 * fields. */
export function parsePlan(data: unknown): Plan {
  return planSchema.parse(data) as unknown as Plan;
}

export type Plan = Omit<components["schemas"]["Plan"], "id" | "orders"> & {
  id: string;
  orders?: Order[];
  warnings: Warning[];
};

export type Warning = components["schemas"]["Warning"];
