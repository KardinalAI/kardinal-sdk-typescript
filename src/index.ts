/** Kardinal TypeScript SDK. */

import { resolveApiKey } from "./core/auth.js";
import { Transport } from "./core/transport.js";
import { PlansAPI } from "./routing/plans.js";
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
}

class Routing {
  readonly plans: PlansAPI;
  readonly solutions: SolutionsAPI;

  constructor(transport: Transport) {
    this.plans = new PlansAPI(transport);
    this.solutions = new SolutionsAPI(transport, this.plans);
  }
}

/**
 * `new Kardinal({ apiKey, baseUrl, timeoutMs: 30_000, maxRetries: 3 })`
 *
 * `apiKey` defaults to the `KARDINAL_API_KEY` environment variable.
 * `baseUrl` defaults to `KARDINAL_BASE_URL`, then
 * `https://app.kardinal.ai/api/v2`: sandbox and production share that host,
 * and the API key determines which agency a call applies to. There's
 * nothing to close: requests go through Node's built-in `fetch`.
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
    this.routing = new Routing(this.transport);
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
export { parsePlanCreate } from "./routing/schemas.js";
export type { PlanCreate, PlanCreateInput, Order, Plan, Stop, SingleStop, AlternativesStop } from "./routing/schemas.js";
export * as examples from "./routing/examples.js";
export type * from "./routing/types.js";
export type { WaitedSolution } from "./routing/solutions.js";
