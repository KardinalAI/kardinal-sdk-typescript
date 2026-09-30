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
export type Warning = components["schemas"]["Warning"];
/** The generated `Solution`, plus `warnings` copied across from the
 * `EnvelopedSolution` envelope (a sibling of `item`, not a field of it). */
export type Solution = components["schemas"]["Solution"] & { warnings: Warning[] };
/** A plain array of `SolutionObjective`, plus `warnings` copied across from
 * the `EnvelopedSolutionObjectives` envelope. */
export type SolutionObjectives = components["schemas"]["SolutionObjective"][] & { warnings: Warning[] };
/** What `start()`/`stop()` return: the plan's current version, which
 * starting or stopping doesn't change. */
export type PlanReference = components["schemas"]["EnvelopedPlanReference"];
export type Tour = components["schemas"]["Tour"];
export type SolutionObjective = components["schemas"]["SolutionObjective"];
export type ErrorEntry = components["schemas"]["Error"];
