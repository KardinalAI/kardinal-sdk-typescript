/**
 * plans: submit, get, update, delete, list/iterAll, start, stop, getStatus.
 */

import type { Transport } from "../core/transport.js";
import { iterAll } from "../core/pagination.js";
import type { Page } from "../core/pagination.js";
import type { PlanCreate, Plan } from "./schemas.js";
import type { PlanLight, PlanState } from "./types.js";

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
  return body;
}

export class PlansAPI {
  constructor(private readonly transport: Transport) {}

  /** `POST /plans`. Creates a new plan and starts optimization — billed in
   * full. The server assigns `id`. */
  async submit(plan: PlanCreate): Promise<Plan> {
    const response = await this.transport.request<{ item: Plan }>("POST", "/plans", { json: plan });
    return response!.item;
  }

  async get(planId: string): Promise<Plan> {
    const response = await this.transport.request<{ item: Plan }>("GET", `/plans/${planId}`);
    return response!.item;
  }

  /** `PUT /plans/{id}`. Same `id`, the version increments on its own.
   * Re-optimizes if needed; only newly added unique stops are billed. */
  async update(plan: Plan): Promise<Plan> {
    const response = await this.transport.request<{ item: Plan }>("PUT", `/plans/${plan.id}`, {
      json: stripReadOnly(plan),
    });
    return response!.item;
  }

  async delete(planId: string): Promise<void> {
    await this.transport.request("DELETE", `/plans/${planId}`);
  }

  /** `GET /plans`. Always paginated; `page`/`itemsPerPage` are sent
   * explicitly so the page asked for is visible in the call itself. */
  async list(
    opts: { page?: number; itemsPerPage?: number; archived?: string } = {}
  ): Promise<Page<PlanLight>> {
    const { page = 1, itemsPerPage = 20, archived = "excluded" } = opts;
    const response = await this.transport.request<{
      items?: PlanLight[];
      paging: { page: number; totalPages: number; total: number; nextPage?: number };
    }>("GET", "/plans", { params: { page, itemsPerPage, archived } });
    const paging = response!.paging;
    return {
      items: response!.items ?? [],
      page: paging.page,
      totalPages: paging.totalPages,
      total: paging.total,
      // Absent on the last page (openapi.yaml `Paging.nextPage`), not null.
      nextPage: paging.nextPage ?? null,
    };
  }

  /** Chains `list()` across every page. */
  iterAll(opts: { archived?: string } = {}): AsyncGenerator<PlanLight> {
    return iterAll((page) => this.list({ page, archived: opts.archived }));
  }

  async start(planId: string): Promise<void> {
    await this.transport.request("PUT", `/plans/${planId}/running`, { json: true });
  }

  async stop(planId: string): Promise<void> {
    await this.transport.request("PUT", `/plans/${planId}/running`, { json: false });
  }

  /** `GET /plans/{id}/state`. Returns the plan's current `PlanState`
   * (`waiting`, `processing`, ..., `optimized`, `stopped`, ...).
   *
   * The type returned is `PlanState` (the enum this endpoint's `state`
   * field actually carries), not the unrelated `PlanStatus` object
   * embedded in `Plan.status` — the spec uses both names for different
   * things (see the README's "known gaps" section). */
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
