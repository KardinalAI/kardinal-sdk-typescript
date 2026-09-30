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
import type { components } from "./generated-types.js";

// --- Scalars (openapi.yaml `RegexIdValidation`, `Duration`) ----------------

const idSchema = z.string().regex(/^[a-zA-Z0-9-._~:@!$,]+$/);
const durationSchema = z.string().regex(/^P(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(\d+H)?(\d+M)?(\d+S)?)?$/);

// --- Position / TimeWindow / TaggedTimeWindow -----------------------------

const positionSchema = z.object({
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
});

const timeWindowSchema = z.object({
  begin: z.string(),
  end: z.string(),
});

const taggedTimeWindowSchema = z.object({
  begin: z.string(),
  end: z.string(),
  resourceTags: z.array(idSchema).optional(),
});

const capacitiesSchema = z.record(z.string(), z.number());

// --- Stops ------------------------------------------------------------------
// The generated Order.stops type is `Omit<Stop, "type">[]` — openapi.yaml
// writes `items: allOf: [$ref: Stop]`, and openapi-typescript strips the
// discriminator when it resolves that pattern, which would silently make
// `type` (required by the real API) look optional-or-absent. This mirrors
// it correctly instead, the same fix the Python sibling SDK applies to the
// analogous Stop1/Stop12/Stop13 codegen artifact there.

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
});

const alternativesStopSchema = z.object({
  id: idSchema,
  type: z.literal("alternatives"),
  alternatives: z.array(singleStopSchema),
});

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
  .strict();

export type Order = z.infer<typeof orderSchema>;

// --- Resource / VehicleProfile ---------------------------------------------
// Every field of openapi.yaml's `Resource` is listed, so unknown ones are
// stripped (as the Python SDK's generated `Resource` ignores them); the
// nested objects of the rarer ones are not deeply validated (see module
// docstring).

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
  maxInterStopDistanceInKm: z.custom<unknown>().optional(),
  maxInterStopDuration: z.custom<unknown>().optional(),
  breaks: z.array(z.custom<unknown>()).optional(),
  operationDurationPolicies: z.array(z.custom<unknown>()).optional(),
  travelTimeCoefficient: z.number().optional(),
  emptyThresholdByCapacity: capacitiesSchema.optional(),
  avoidEarlyLoadings: z.array(z.custom<unknown>()).optional(),
}) as unknown as z.ZodType<Resource>;

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
  .strict();

export type PlanCreateInput = z.input<typeof planCreateSchema>;
export type PlanCreate = z.infer<typeof planCreateSchema>;

/** Parses and validates a `PlanCreate`, throwing a Zod error listing every
 * problem found — not just the first — if the input is malformed. */
export function parsePlanCreate(data: unknown): PlanCreate {
  return planCreateSchema.parse(data);
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
export type Plan = Omit<components["schemas"]["Plan"], "id" | "orders"> & {
  id: string;
  orders?: Order[];
  warnings: Warning[];
};

export type Warning = components["schemas"]["Warning"];
