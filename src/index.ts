/** Kardinal TypeScript SDK. */

import { resolveApiKey } from "./core/auth.js";
import { Transport } from "./core/transport.js";
import { PlansAPI } from "./routing/plans.js";
import type { UnknownField } from "./routing/schemas.js";
import { SolutionsAPI } from "./routing/solutions.js";

export interface KardinalOptions {
  /** Defaults to the `KARDINAL_API_KEY` environment variable. `""` throws
   * `EmptyApiKeyError` instead of falling back to it. */
  apiKey?: string;
  /** Defaults to `KARDINAL_BASE_URL`, then `https://app.kardinal.ai/api/v2`. */
  baseUrl?: string;
  /** Each request's timeout, in milliseconds, including reading the
   * response. Default: 30000. */
  timeoutMs?: number;
  /** How many times a read, `update()`, `delete()`, `start()` or `stop()`
   * is retried after a network error, a 429 or a 5xx (`submit()` never is).
   * Default: 3. */
  maxRetries?: number;
  /** Where `update()` reports a key that looks like a typo on a plan this
   * SDK never read, and so cannot check exactly.
   *
   * It also receives each kind of warning the API returns to `submit()`,
   * `update()` and `replace()`, as one line with an empty `fields`.
   * A handler that throws, or returns a promise that rejects, never fails
   * the call for an API warning. The failure goes to `console.error`.
   *
   * Defaults to `console.warn`. Pass your own logger to route the lines into
   * a real log pipeline, or a no-op to stay quiet. */
  onWarning?: (message: string, fields: UnknownField[]) => void;
}

/** What `Kardinal.whoami()` reports about the API key in use. */
export interface Whoami {
  /** The host the key was checked against. */
  baseUrl: string;
  /** The agency the key resolves to, or `null` when the API names none. */
  agencyId: string | null;
}

class Routing {
  readonly plans: PlansAPI;
  readonly solutions: SolutionsAPI;

  constructor(transport: Transport, onWarning?: KardinalOptions["onWarning"]) {
    this.plans = new PlansAPI(transport, onWarning);
    this.solutions = new SolutionsAPI(transport, this.plans);
  }
}

/**
 * `new Kardinal({ apiKey, baseUrl, timeoutMs: 30_000, maxRetries: 3 })`
 *
 * `apiKey` defaults to the `KARDINAL_API_KEY` environment variable.
 * `baseUrl` defaults to `KARDINAL_BASE_URL`, then
 * `https://app.kardinal.ai/api/v2`. A key is valid only against the host it
 * was issued for: sent elsewhere it is rejected as though the key itself
 * were invalid, so the error points at the key rather than the address. The
 * key then determines which agency a call applies to. There's nothing to
 * close: requests go through Node's built-in `fetch`.
 */
export class Kardinal {
  readonly routing: Routing;
  private readonly transport: Transport;

  constructor(options: KardinalOptions = {}) {
    const apiKey = resolveApiKey(options.apiKey);
    this.transport = new Transport({
      apiKey,
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
    });
    this.routing = new Routing(this.transport, options.onWarning);
  }

  /**
   * Reports the host and the agency the API key resolves to.
   *
   * The call is free: it is a read, retried like any read. Compare
   * `agencyId` with your own configuration at startup, so a sandbox key
   * is never used where you expect production.
   */
  async whoami(): Promise<Whoami> {
    const response = await this.transport.request<{ agencyId?: string }>("GET", "/plans", {
      params: { page: 1, itemsPerPage: 1, archived: "excluded" },
    });
    return { baseUrl: this.transport.baseUrl, agencyId: response?.agencyId ?? null };
  }

  /** @internal exposed for `auth check`-style diagnostics, not routine use */
  get _transport(): Transport {
    return this.transport;
  }
}

export * from "./core/errors.js";
export { MissingApiKeyError, EmptyApiKeyError } from "./core/auth.js";
export type { Page } from "./core/pagination.js";
export type { ArchivedFilter } from "./routing/plans.js";
// `unknownFields` is the check `submit()` makes, exported so a caller can
// run it before sending — the CLI has `validate`, and a library had no
// equivalent once submit() started throwing on an unknown key.
export { parsePlanCreate, parsePlan, unknownFields } from "./routing/schemas.js";
export type { UnknownField } from "./routing/schemas.js";
export type { PlanCreate, PlanCreateInput, Order, Plan, Stop, SingleStop, AlternativesStop } from "./routing/schemas.js";
export * as examples from "./routing/examples.js";
export type * from "./routing/types.js";
export type { WaitedSolution } from "./routing/solutions.js";
