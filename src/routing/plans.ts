/**
 * plans: submit, get, update, delete, list/iterAll, start, stop, getStatus.
 */

import type { Transport } from "../core/transport.js";
import { iterAll } from "../core/pagination.js";
import type { Page } from "../core/pagination.js";
import type { PlanCreate, Plan } from "./schemas.js";
import type { PlanLight, PlanState } from "./types.js";

// Server-computed fields update() must not echo back on PUT — POST already
// actively rejects an unexpected `id`, so nothing guarantees a future PUT
// stays lenient about these just because it is today.
const PLAN_READ_ONLY_FIELDS = [
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

  /** `GET /plans`. Always sends `page`/`itemsPerPage` explicitly: the API
   * only skips pagination when both are absent from the request. */
  async list(
    opts: { page?: number; itemsPerPage?: number; archived?: string } = {}
  ): Promise<Page<PlanLight>> {
    const { page = 1, itemsPerPage = 20, archived = "excluded" } = opts;
    const response = await this.transport.request<{
      items?: PlanLight[];
      paging: { page: number; totalPages: number; total: number; nextPage: number | null };
    }>("GET", "/plans", { params: { page, itemsPerPage, archived } });
    const paging = response!.paging;
    return {
      items: response!.items ?? [],
      page: paging.page,
      totalPages: paging.totalPages,
      total: paging.total,
      nextPage: paging.nextPage,
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
    const response = await this.transport.request<{ item: { state: PlanState } }>(
      "GET",
      `/plans/${planId}/state`
    );
    return response!.item.state;
  }
}
