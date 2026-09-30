/**
 * Kardinal TypeScript SDK.
 *
 * `apiKey` defaults to the `KARDINAL_API_KEY` environment variable.
 * `baseUrl` defaults to `KARDINAL_BASE_URL`, then production — a token
 * only authenticates against the host matching whatever console issued it,
 * so pointing at a non-production environment needs one of these two set.
 */

import { resolveApiKey } from "./core/auth.js";
import { Transport } from "./core/transport.js";
import { PlansAPI } from "./routing/plans.js";
import { SolutionsAPI } from "./routing/solutions.js";

export interface KardinalOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
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
export { parsePlanCreate } from "./routing/schemas.js";
export type { PlanCreate, PlanCreateInput, Order, Plan, Stop, SingleStop, AlternativesStop } from "./routing/schemas.js";
export * as examples from "./routing/examples.js";
export type * from "./routing/types.js";
