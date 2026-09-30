/** solutions: get, getObjectives, wait. */

import type { Transport } from "../core/transport.js";
import type { PlansAPI } from "./plans.js";
import type { Solution, SolutionObjective, PlanState } from "./types.js";
import { parseDurationMs } from "../core/duration.js";
import { KardinalTimeoutError } from "../core/errors.js";

const POLL_INTERVAL_MS = 2_000;
const TERMINAL_STATES: readonly PlanState[] = ["optimized", "stopped", "interrupted", "deleted"];

export class SolutionsAPI {
  constructor(
    private readonly transport: Transport,
    private readonly plans: PlansAPI
  ) {}

  async get(planId: string): Promise<Solution> {
    const response = await this.transport.request<{ item: Solution }>("GET", `/plans/${planId}/solution`);
    return response!.item;
  }

  /** The cheap-to-poll endpoint for tracking progress without waiting. */
  async getObjectives(planId: string): Promise<SolutionObjective[]> {
    const response = await this.transport.request<{ items?: SolutionObjective[] }>(
      "GET",
      `/plans/${planId}/solution/objectives`
    );
    return response!.items ?? [];
  }

  /**
   * Blocks until the plan reaches a terminal `PlanState`, then returns its
   * solution. Sleeps for `maxOptimizationDuration` once (the engine stops
   * early on its own once it stops improving, so this isn't a guessed
   * budget), then polls `getStatus` at a short interval.
   *
   * `timeoutMs` is a hard guard that rejects with `KardinalTimeoutError`,
   * not a target duration — for finer-grained tracking without blocking,
   * use `getObjectives` (cheap to poll) or `getStatus`.
   */
  async wait(planId: string, timeoutMs?: number): Promise<Solution> {
    const deadline = timeoutMs === undefined ? null : Date.now() + timeoutMs;

    const plan = await this.plans.get(planId);
    if (plan.maxOptimizationDuration) {
      await this.sleepOrTimeout(parseDurationMs(plan.maxOptimizationDuration), deadline, planId);
    }

    for (;;) {
      const state = await this.plans.getStatus(planId);
      if (TERMINAL_STATES.includes(state)) return this.get(planId);
      await this.sleepOrTimeout(POLL_INTERVAL_MS, deadline, planId);
    }
  }

  private async sleepOrTimeout(ms: number, deadline: number | null, planId: string): Promise<void> {
    if (deadline !== null && Date.now() + ms > deadline) {
      const remaining = deadline - Date.now();
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      throw new KardinalTimeoutError(`Timed out waiting for plan "${planId}" to finish optimizing.`, {
        code: "CLIENT_TIMEOUT",
        status: 0,
        requestId: null,
        retryable: false,
      });
    }
    await new Promise((r) => setTimeout(r, ms));
  }
}
