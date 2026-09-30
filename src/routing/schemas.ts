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
 * v0 scope note: `orders`/`stops` and the top-level scalar fields are
 * fully validated below; `resources` checks the three fields openapi.yaml
 * actually marks required (id, vehicleProfile, workingTimeWindow) but not
 * every nested constraint. The rarer plan-level fields
 * (`additionalConstraints`, `globalConstraints`, `objectives`, and the
 * other `*ByResourceTag`/`*ByStopTag` maps) are typed for compile-time
 * safety via the generated schema types, but not yet deeply validated at
 * runtime the way the Python SDK's fully pydantic-backed models are — a
 * malformed value there fails server-side (400), not locally. Deepening
 * this is on the list for a later version, not v0.
 */

import { z } from "zod";
import type { components } from "./generated-types.js";

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
  resourceTags: z.array(z.string()).optional(),
});

const capacitiesSchema = z.record(z.string(), z.number());

// --- Stops ------------------------------------------------------------------
// The generated Order.stops type is `Omit<Stop, "type">[]` — openapi.yaml
// writes `items: allOf: [$ref: Stop]`, and openapi-typescript strips the
// discriminator when it resolves that pattern, which would silently make
// `type` (required by the real API) look optional-or-absent. This mirrors
// it correctly instead, the same fix the Python sibling SDK applies to the
// analogous Stop1/Stop11/Stop12 codegen artifact there.

const singleStopSchema = z.object({
  type: z.literal("single"),
  id: z.string(),
  properties: z.record(z.string(), z.string()).optional(),
  tags: z.array(z.string()).optional(),
  position: positionSchema,
  kind: z.enum(["pickup", "delivery", "acknowledgement"]).optional(),
  operationDuration: z.string().optional(),
  capacities: capacitiesSchema.optional(),
  authorizedTimeWindows: z.array(taggedTimeWindowSchema).optional(),
  preferredTimeWindows: z.array(taggedTimeWindowSchema).optional(),
});

const alternativesStopSchema = z.object({
  id: z.string(),
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
    id: z.string(),
    properties: z.record(z.string(), z.string()).optional(),
    priority: z.number().default(0),
    optional: z.boolean().optional(),
    requiredSkills: z.array(z.string()).optional(),
    stops: z.array(stopSchema).min(1),
    successiveStops: z.boolean().optional(),
    maxStopSpan: z.string().optional(),
  })
  .strict();

export type Order = z.infer<typeof orderSchema>;

// --- Resource / VehicleProfile ---------------------------------------------
// Only the three fields openapi.yaml actually marks required are checked
// here (id, vehicleProfile, workingTimeWindow) — everything else is typed
// via the generated schema but not deeply validated in v0 (see module
// docstring). `.passthrough()` keeps every other field instead of
// stripping it, since this is a floor on validation, not the full shape.

export type Resource = components["schemas"]["Resource"];
const resourceSchema = z
  .object({
    id: z.string(),
    vehicleProfile: z.object({ type: z.string() }).passthrough(),
    workingTimeWindow: z.object({ begin: z.string(), end: z.string() }).passthrough(),
  })
  .passthrough() as unknown as z.ZodType<Resource>;

// --- PlanCreate -----------------------------------------------------------

export const planCreateSchema = z
  .object({
    properties: z.record(z.string(), z.string()).optional(),
    resources: z.array(resourceSchema).min(1),
    orders: z.array(orderSchema).optional(),
    additionalOperationDurations: z.array(z.custom<unknown>()).optional(),
    operationDurationPoliciesByResourceTag: z.record(z.string(), z.custom<unknown>()).optional(),
    additionalConstraints: z.array(z.custom<unknown>()).optional(),
    globalConstraints: z.array(z.custom<unknown>()).optional(),
    accessDurationsByStopTag: z.record(z.string(), z.string()).optional(),
    overlappingCapacitiesByStopTag: z.record(z.string(), z.number()).optional(),
    setupDurations: z.array(z.custom<unknown>()).optional(),
    objectives: z.custom<unknown>().optional(),
    maxOptimizationDuration: z.string().optional(),
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

export type Plan = Omit<components["schemas"]["Plan"], "id" | "orders"> & {
  id: string;
  orders?: Order[];
};
