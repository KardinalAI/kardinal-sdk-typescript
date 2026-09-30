/**
 * plans: submit, get, update, delete, list/iterAll, start, stop, getStatus.
 */

import type { Transport } from "../core/transport.js";
import { iterAll } from "../core/pagination.js";
import type { Page } from "../core/pagination.js";
import { parsePlanCreate } from "./schemas.js";
import type { PlanCreateInput, Plan, Warning } from "./schemas.js";
import type { PlanLight, PlanReference, PlanState } from "./types.js";

// Fields openapi.yaml marks `readOnly`, which update() must not echo back
// on PUT. `id` only travels in the URL: the server rejects a body `id` that
// doesn't match it, and POST already rejects any body `id`.
const PLAN_READ_ONLY_FIELDS = [
  "id",
  "agencyId",
  "version",
  "running",
  "status",
  "state",
  "nbResources",
  "nbOrders",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "archivedAt",
] as const;

function stripReadOnly(plan: Plan): Record<string, unknown> {
  const body: Record<string, unknown> = { ...plan };
  for (const field of PLAN_READ_ONLY_FIELDS) delete body[field];
  delete body.warnings; // this SDK's own field (see `Plan`), not the plan's
  return body;
}

type EnvelopedPlan = { item: Omit<Plan, "warnings">; warnings?: Warning[] };

/** `EnvelopedPlan.item`, plus `EnvelopedPlan.warnings` copied onto it. */
function planFromEnvelope(response: EnvelopedPlan | null): Plan {
  return { ...response!.item, warnings: response!.warnings ?? [] };
}

export type ArchivedFilter = "excluded" | "included" | "only";

/** `k.routing.plans`: submit, get, update, delete, list/iterAll, start,
 * stop, getStatus. */
export class PlansAPI {
  constructor(private readonly transport: Transport) {}

  /** `POST /plans`. Creates a new plan and starts optimization — billed in
   * full. The server assigns `id`. The plan is validated locally first
   * (`parsePlanCreate`: throws a `ZodError` listing every problem, before
   * anything is sent or billed), which also applies its defaults. */
  async submit(plan: PlanCreateInput): Promise<Plan> {
    const body = parsePlanCreate(plan);
    const response = await this.transport.request<EnvelopedPlan>("POST", "/plans", { json: body });
    return planFromEnvelope(response);
  }

  /** `GET /plans/{id}`. The plan as currently stored. */
  async get(planId: string): Promise<Plan> {
    const response = await this.transport.request<EnvelopedPlan>("GET", `/plans/${planId}`);
    return planFromEnvelope(response);
  }

  /** `PUT /plans/{id}`. Sends the complete plan, replacing the stored one
   * (anything left out is removed; fields this SDK version doesn't know,
   * read by `get()`, are kept and sent back). The version increments, and
   * the plan is re-optimized, only if the plan actually changed: an
   * identical PUT is a free no-op, returning the same version. Only newly
   * added unique stops are billed.
   *
   * `force` unarchives the plan first if it's archived; ignored otherwise. */
  async update(plan: Plan, opts: { force?: boolean } = {}): Promise<Plan> {
    const response = await this.transport.request<EnvelopedPlan>("PUT", `/plans/${plan.id}`, {
      json: stripReadOnly(plan),
      params: { force: String(opts.force ?? false) },
    });
    return planFromEnvelope(response);
  }

  /** `DELETE /plans/{id}`. Permanently deletes the plan and its solution;
   * any optimization in progress is stopped. */
  async delete(planId: string): Promise<void> {
    await this.transport.request("DELETE", `/plans/${planId}`);
  }

  /** `GET /plans`. Always paginated; `page`/`itemsPerPage` are sent
   * explicitly so the page asked for is visible in the call itself. */
  async list(
    opts: { page?: number; itemsPerPage?: number; archived?: ArchivedFilter } = {}
  ): Promise<Page<PlanLight>> {
    const { page = 1, itemsPerPage = 20, archived = "excluded" } = opts;
    const response = await this.transport.request<{
      items?: PlanLight[];
      paging: {
        page: number;
        totalPages: number;
        total: number;
        nextPage?: number;
        previousPage?: number;
        itemsPerPage?: number;
      };
    }>("GET", "/plans", { params: { page, itemsPerPage, archived } });
    const paging = response!.paging;
    return {
      items: response!.items ?? [],
      page: paging.page,
      totalPages: paging.totalPages,
      total: paging.total,
      // Absent on the last page (openapi.yaml `Paging.nextPage`), not null.
      nextPage: paging.nextPage ?? null,
      previousPage: paging.previousPage ?? null,
      itemsPerPage: paging.itemsPerPage ?? null,
    };
  }

  /** Chains `list()` across every page. */
  iterAll(opts: { archived?: ArchivedFilter } = {}): AsyncGenerator<PlanLight> {
    return iterAll((page) => this.list({ page, archived: opts.archived }));
  }

  /** `PUT /plans/{id}/running` with `true`. Restarts optimization on the
   * current version of the plan, without changing its data or `version` —
   * the returned reference's `planVersion` is that same, unchanged version,
   * not a new one.
   *
   * `force` unarchives the plan first if it's archived; ignored otherwise. */
  async start(planId: string, opts: { force?: boolean } = {}): Promise<PlanReference> {
    const response = await this.transport.request<PlanReference>("PUT", `/plans/${planId}/running`, {
      json: true,
      params: { force: String(opts.force ?? false) },
    });
    return response!;
  }

  /** `PUT /plans/{id}/running` with `false`. Stops optimization on the
   * current version of the plan, without changing its data or `version`.
   *
   * `force` unarchives the plan first if it's archived; ignored otherwise. */
  async stop(planId: string, opts: { force?: boolean } = {}): Promise<PlanReference> {
    const response = await this.transport.request<PlanReference>("PUT", `/plans/${planId}/running`, {
      json: false,
      params: { force: String(opts.force ?? false) },
    });
    return response!;
  }

  /** `GET /plans/{id}/state`. Returns the plan's current `PlanState`
   * (`waiting`, `processing`, ..., `optimized`, `stopped`, ...), or the
   * raw string for a state this version of the SDK doesn't know yet.
   *
   * The type returned is `PlanState` (the enum this endpoint's `state`
   * field actually carries), not the unrelated `PlanStatus` object
   * embedded in `Plan.status` — the spec uses both names for different
   * things (see the README's "Good to know" section). */
  async getStatus(planId: string): Promise<PlanState> {
    return (await this._getState(planId)).state;
  }

  /** @internal `getStatus()` plus the `planVersion` that state belongs to —
   * `solutions.wait()` needs both, since right after `update()` this
   * endpoint can still report the previous version's state. */
  async _getState(planId: string): Promise<{ state: PlanState; planVersion: number | null }> {
    const response = await this.transport.request<{ item: { state: PlanState; planVersion?: number } }>(
      "GET",
      `/plans/${planId}/state`
    );
    return { state: response!.item.state, planVersion: response!.item.planVersion ?? null };
  }
}
