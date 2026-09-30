/**
 * Friendly re-exports of the generated schema types. Never hand-edit
 * generated-types.ts itself — this file is the stable surface built on
 * top of it, reapplied after every regeneration the same way the Python
 * sibling SDK's `_annotations.py` is.
 */

import type { components } from "./generated-types.js";

export type Resource = components["schemas"]["Resource"];
export type SingleStop = components["schemas"]["SingleStop"];
export type AlternativesStop = components["schemas"]["AlternativesStop"];
export type Position = components["schemas"]["Position"];
export type TimeWindow = components["schemas"]["TimeWindow"];
export type TaggedTimeWindow = components["schemas"]["TaggedTimeWindow"];
export type Capacities = components["schemas"]["Capacities"];
export type VehicleProfileCar = components["schemas"]["VehicleProfileCar"];
export type VehicleProfileTruck = components["schemas"]["VehicleProfileTruck"];
export type Duration = components["schemas"]["Duration"];
export type PlanState = components["schemas"]["PlanState"];
export type PlanLight = components["schemas"]["PlanLight"];
export type Solution = components["schemas"]["Solution"];
export type Tour = components["schemas"]["Tour"];
export type SolutionObjective = components["schemas"]["SolutionObjective"];
export type ErrorEntry = components["schemas"]["Error"];
