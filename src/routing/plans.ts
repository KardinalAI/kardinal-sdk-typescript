/**
 * plans: submit, get, update, delete, list/iterAll, start, stop, getStatus.
 */

import type { Transport } from "../core/transport.js";
import { iterAll } from "../core/pagination.js";
import type { Page } from "../core/pagination.js";
import { PLAN_READ_ONLY_FIELDS, parsePlanCreate, planSchema, unknownFields } from "./schemas.js";
import { UnknownFieldError } from "../core/errors.js";
import type { PlanCreateInput, Plan, Warning, UnknownField } from "./schemas.js";
import type { PlanLight, PlanReference, PlanState } from "./types.js";

// `id` only travels in the URL: the server rejects a body `id` that doesn't
// match it, and on POST an `id` in the body is ignored and replaced by a
// generated one. The list itself lives in `schemas.ts`, where the same names
// also explain the key to a caller who resubmitted a plan they had read.
function stripReadOnly(plan: Plan): Record<string, unknown> {
  const body: Record<string, unknown> = { ...plan };
  for (const field of PLAN_READ_ONLY_FIELDS) delete body[field];
  delete body.warnings; // this SDK's own field (see `Plan`), not the plan's
  return body;
}

type EnvelopedPlan = { item: Omit<Plan, "warnings">; warnings?: Warning[] };

/** Unknown keys the server sent, per plan id it sent them on.
 *
 * The API drops any key it doesn't know — checked against the sandbox on
 * both POST and PUT — so a key it sends back is a real field by
 * construction, and one only the caller added is a typo. `update()` uses
 * this to tell them apart.
 *
 * Keyed on the plan's id rather than on the object: `{ ...plan }` is how
 * TypeScript edits immutably, and a plan passing through a cache, a queue
 * or an HTTP hop arrives as fresh JSON. Keying on identity would have made
 * the check hold for direct mutation of the returned object and almost
 * nothing else. An id survives all of it.
 *
 * Held per client rather than per module: two clients in one process are
 * two different callers, and one shouldn't vouch for what the other read.
 * A plan read by another client, or in another process, has no record and
 * falls back to the weaker check — a warning on near-misses only, which
 * never refuses a real API field but no longer catches a typo either.
 * Capped so a long-lived client can't grow it without bound; the oldest
 * entry goes first, and losing one only costs that fallback.
 */
const SERVER_KEYS_REMEMBERED = 64;

function shapeKey(field: { path: string; key: string }): string {
  return field.path.replace(/\[\d+\]/g, "").replace(/^plan\./, "");
}

/** `EnvelopedPlan.item`, plus `EnvelopedPlan.warnings` copied onto it. */
function planFromEnvelope(response: EnvelopedPlan | null): Plan {
  return { ...response!.item, warnings: response!.warnings ?? [] } as Plan;
}

/** Throws on anything left after the caller's `allowUnknown`.
 *
 * `allowUnknown` names fields to send that this SDK version doesn't
 * declare — a field the API gained since it was released. Named one by one
 * on purpose: switching the check off entirely would wave through a typo
 * anywhere else in the plan, which is what it exists to catch. A name given
 * there is allowed on every object of the plan, not just the one the caller
 * had in mind.
 */
function refuseUnknown(fields: UnknownField[], allowUnknown?: string[]): void {
  const allowed = new Set(allowUnknown ?? []);
  const refused = fields.filter((field) => !allowed.has(field.key));
  if (refused.length > 0) throw new UnknownFieldError(refused);
}

export type ArchivedFilter = "excluded" | "included" | "only";

/** `k.routing.plans`: submit, get, update, delete, list/iterAll, start,
 * stop, getStatus. */
export class PlansAPI {
  private readonly serverKeys = new Map<string, Set<string>>();

  constructor(
    private readonly transport: Transport,
    private readonly onWarning: (message: string, fields: UnknownField[]) => void = (m) =>
      console.warn(m),
  ) {}

  private rememberServerKeys(planId: string, keys: Set<string>): void {
    this.serverKeys.delete(planId); // re-insert, so it counts as most recent
    this.serverKeys.set(planId, keys);
    for (const oldest of this.serverKeys.keys()) {
      if (this.serverKeys.size <= SERVER_KEYS_REMEMBERED) break;
      this.serverKeys.delete(oldest);
    }
  }

  private planFromEnvelope(response: EnvelopedPlan | null): Plan {
    const plan = planFromEnvelope(response);
    this.rememberServerKeys(plan.id, new Set(unknownFields(plan, planSchema).map(shapeKey)));
    return plan;
  }

  /** `POST /plans`. Creates a new plan and starts optimization — billed in
   * full. The server assigns `id`.
   *
   * The plan is validated locally first, before anything is sent or billed,
   * and its defaults applied: a `ZodError` for a malformed value, listing
   * every problem rather than the first, and an `UnknownFieldError` for a
   * key no schema declares — the misspelled field the API would otherwise
   * drop in silence. A malformed value is reported first when a plan has
   * both.
   *
   * `allowUnknown` names keys to send anyway, for a field the API gained
   * after this SDK version. One by one rather than switching the check off,
   * and a name given there is allowed anywhere in the plan. */
  async submit(plan: PlanCreateInput, opts: { allowUnknown?: string[] } = {}): Promise<Plan> {
    // parsePlanCreate reports both kinds of problem, so there is nothing to
    // check separately here.
    const body = parsePlanCreate(plan, opts.allowUnknown ?? []);
    const response = await this.transport.request<EnvelopedPlan>("POST", "/plans", { json: body });
    return this.planFromEnvelope(response);
  }

  /** `GET /plans/{id}`. The plan as currently stored. Never carries
   * warnings: they're only returned by `submit()`/`update()`. */
  async get(planId: string): Promise<Plan> {
    const response = await this.transport.request<EnvelopedPlan>("GET", `/plans/${planId}`);
    return this.planFromEnvelope(response);
  }

  /** `PUT /plans/{id}`. Sends the complete plan, replacing the stored one
   * (anything left out is removed; fields this SDK version doesn't know,
   * read by `get()`, are kept and sent back). The version increments, and
   * the plan is re-optimized, only if the plan actually changed: an
   * identical PUT is a free no-op, returning the same version. Only newly
   * added unique stops are billed.
   *
   * `force` unarchives the plan first if it's archived; ignored otherwise.
   *
   * `allowUnknown` names keys to let through, for a field the API gained
   * after this SDK version. A name listed there is allowed anywhere in the
   * plan, so prefer a distinctive one over a common word like `priority`. */
  async update(
    plan: Plan,
    opts: { force?: boolean; allowUnknown?: string[] } = {},
  ): Promise<Plan> {
    const unknown = unknownFields(plan, planSchema);
    const fromServer = this.serverKeys.get(plan.id);
    if (fromServer) {
      refuseUnknown(
        unknown.filter((field) => !fromServer.has(shapeKey(field))),
        opts.allowUnknown,
      );
    } else {
      const allowed = new Set(opts.allowUnknown ?? []);
      const likelyTypos = unknown.filter((f) => f.suggestion && !allowed.has(f.key));
      if (likelyTypos.length > 0) {
        const listed = likelyTypos
          .map((f) => `${f.path} (did you mean ${f.suggestion}?)`)
          .join(", ");
        this.onWarning(`Possible typo(s) in the plan being sent: ${listed}`, likelyTypos);
      }
    }
    const response = await this.transport.request<EnvelopedPlan>("PUT", `/plans/${plan.id}`, {
      json: stripReadOnly(plan),
      params: { force: String(opts.force ?? false) },
    });
    return this.planFromEnvelope(response);
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
  async getStatus(planId: string): Promise<PlanState | (string & {})> {
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
