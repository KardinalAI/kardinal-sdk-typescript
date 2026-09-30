/** solutions: get, getObjectives, wait. */

import type { Transport } from "../core/transport.js";
import type { PlansAPI } from "./plans.js";
import type { Solution, SolutionObjective, SolutionObjectives, PlanState, Warning } from "./types.js";
import { parseDurationMs } from "../core/duration.js";
import {
  KardinalConnectionError,
  KardinalError,
  KardinalNotFoundError,
  KardinalOptimizationError,
  KardinalRateLimitError,
  KardinalServerError,
  KardinalTimeoutError,
} from "../core/errors.js";

// Polling cadence agreed with the backend team: never more often than every
// 10s (each poll hits a shared backend), stretching to 10% of the time
// already waited, capped at 60s — a 6h optimization costs ~380 polls, not
// the ~2,200 a fixed 10s interval would.
const MIN_POLL_MS = 10_000;
const MAX_POLL_MS = 60_000;
const POLL_FRACTION = 0.1;
// An engine that crashes never reports again: the state stays `optimizing`
// until the broker drops the plan 24h later. Past its own budget plus this
// margin, the optimization is presumed dead.
const STALL_MARGIN_MS = 300_000;
// `stopped` during `optimizing` is followed by `interrupted` once the engine
// has actually stopped — the solution can still improve in between.
const STOPPED_GRACE_MS = 60_000;
const OPTIMIZING_STATES: readonly PlanState[] = ["optimizing", "preOptimizing"];

/** What `wait()` returns: the solution, plus the plan state it stopped on —
 * `optimized`, or `interrupted`/`stopped` when the optimization was cut
 * short (stopped, replaced, or the engine gave up) and this is the best it
 * got to. */
export type WaitedSolution = Solution & { finalState: PlanState };

// 429 here comes from the cluster ("no backend available right now"), not
// the API: like 5xx and network failures, worth riding out, not surfacing.
function isTransient(error: unknown): boolean {
  return (
    error instanceof KardinalRateLimitError ||
    error instanceof KardinalServerError ||
    error instanceof KardinalConnectionError
  );
}

/** @internal exported for tests */
export function pollIntervalMs(elapsedMs: number): number {
  return Math.min(Math.max(elapsedMs * POLL_FRACTION, MIN_POLL_MS), MAX_POLL_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Tracker {
  state: PlanState | null;
  since: number;
  stoppedSince: number | null;
}

export class SolutionsAPI {
  constructor(
    private readonly transport: Transport,
    private readonly plans: PlansAPI
  ) {}

  /** `GET /plans/{id}/solution`. The current best solution, right away.
   *
   * Rejects with `KardinalNotFoundError` until a first solution exists
   * (while the plan is `waiting` or `processing`). The first solutions can
   * be empty or incomplete while the engine is still optimizing, and right
   * after `update()` this can still be the previous version's solution
   * (compare `planVersion`). `wait()` handles all of that. */
  async get(planId: string): Promise<Solution> {
    const response = await this.transport.request<{ item: Omit<Solution, "warnings">; warnings?: Warning[] }>(
      "GET",
      `/plans/${planId}/solution`
    );
    return { ...response!.item, warnings: response!.warnings ?? [] };
  }

  /** `GET /plans/{id}/solution/objectives`. Only the value of each
   * objective, without the tours, as a plain array with a `warnings`
   * property attached. To track progress without waiting, poll no more than
   * once every 10 seconds per plan. */
  async getObjectives(planId: string): Promise<SolutionObjectives> {
    const response = await this.transport.request<{ items?: SolutionObjective[]; warnings?: Warning[] }>(
      "GET",
      `/plans/${planId}/solution/objectives`
    );
    return Object.assign(response!.items ?? [], { warnings: response!.warnings ?? [] });
  }

  /**
   * Waits until the plan's current version stops optimizing, then returns
   * its solution, with `finalState` telling how it ended: `optimized`, or
   * `interrupted`/`stopped` if it was cut short (check it before trusting
   * the result as final).
   *
   * Polls `getStatus` every 10s at first, stretching to every 60s on long
   * optimizations; transient failures (429, 5xx, network) are ridden out.
   * Meant for scripts — a server tracking many plans should schedule its
   * own `getStatus` calls instead.
   *
   * Rejects with `KardinalOptimizationError` when there's no solution to
   * return for this version (`NO_SOLUTION`), a newer version was pushed
   * meanwhile (`PLAN_SUPERSEDED`), or the plan is still optimizing 5
   * minutes past its `maxOptimizationDuration` (`OPTIMIZATION_STALLED`: the
   * engine most likely crashed); `KardinalNotFoundError` if the plan gets
   * deleted.
   *
   * `timeoutMs` is a hard guard that rejects with `KardinalTimeoutError`,
   * not a target duration. It's the only guard against a plan stuck before
   * optimization starts (`waiting`/`processing`), since how long those
   * legitimately last isn't bounded.
   */
  async wait(planId: string, timeoutMs?: number): Promise<WaitedSolution> {
    const start = performance.now();
    const deadline = timeoutMs === undefined ? null : start + timeoutMs;
    const plan = await this.plans.get(planId);
    const version = plan.version ?? null;
    const budgetMs = plan.maxOptimizationDuration != null ? parseDurationMs(plan.maxOptimizationDuration) : null;

    const tracker: Tracker = { state: null, since: start, stoppedSince: null };
    for (;;) {
      const now = performance.now();
      let pause = pollIntervalMs(now - start);
      if (deadline !== null) pause = Math.min(pause, Math.max(deadline - now, 0));
      await sleep(pause);

      let result: WaitedSolution | null;
      try {
        result = await this.pollOnce(planId, version, budgetMs, tracker);
      } catch (e) {
        if (!isTransient(e)) throw e;
        result = null;
      }
      if (result !== null) return result;
      if (deadline !== null && performance.now() >= deadline) {
        throw new KardinalTimeoutError(
          `Timed out waiting for plan "${planId}" to finish optimizing (last state seen: ${tracker.state ?? "none"}).`,
          { code: "CLIENT_TIMEOUT", status: 0, requestId: null, retryable: false }
        );
      }
    }
  }

  /** One `wait()` poll: the solution if the plan is done, `null` to keep
   * waiting, or rejects. `tracker` carries what polls need to remember:
   * the last state seen, since when, and since when it has been `stopped`. */
  private async pollOnce(
    planId: string,
    version: number | null,
    budgetMs: number | null,
    tracker: Tracker
  ): Promise<WaitedSolution | null> {
    const { state, planVersion: stateVersion } = await this.plans._getState(planId);
    if (version !== null && stateVersion !== null) {
      if (stateVersion > version) {
        throw new KardinalOptimizationError(
          `Plan "${planId}" was replaced by version ${stateVersion} while waiting for version ${version}.`,
          { code: "PLAN_SUPERSEDED", planId, planVersion: version, state }
        );
      }
      if (stateVersion < version) return null; // right after update(): /state hasn't caught up yet
    }
    const now = performance.now();
    if (state !== tracker.state) {
      tracker.state = state;
      tracker.since = now;
    }

    if (state === "deleted") throw deletedError(planId);
    if (state === "optimized" || state === "interrupted") return this.finalSolution(planId, version, state);
    if (state === "stopped") {
      if (tracker.stoppedSince === null) {
        // Rejects right away if there's no solution at all — stopped
        // before the engine was even called.
        await this.finalSolution(planId, version, state);
        tracker.stoppedSince = now;
      } else if (now - tracker.stoppedSince >= STOPPED_GRACE_MS) {
        return this.finalSolution(planId, version, state);
      }
      return null;
    }
    tracker.stoppedSince = null;
    if (OPTIMIZING_STATES.includes(state) && budgetMs !== null && now - tracker.since > budgetMs + STALL_MARGIN_MS) {
      throw new KardinalOptimizationError(
        `Plan "${planId}" is still ${state} more than ${STALL_MARGIN_MS / 60_000} minutes past its ` +
          "maxOptimizationDuration; the optimization most likely crashed.",
        { code: "OPTIMIZATION_STALLED", planId, planVersion: version, state }
      );
    }
    return null;
  }

  /** The solution for exactly `version`, or why there isn't one. A 404 is
   * told apart (plan gone vs. no solution yet) by re-reading the plan, not
   * by parsing the error's free-text `details`. */
  private async finalSolution(planId: string, version: number | null, state: PlanState): Promise<WaitedSolution> {
    let solution: Solution | null;
    try {
      solution = await this.get(planId);
    } catch (e) {
      if (!(e instanceof KardinalNotFoundError)) throw e;
      try {
        await this.plans.get(planId);
      } catch (e2) {
        if (e2 instanceof KardinalNotFoundError) throw deletedError(planId);
        throw e2;
      }
      solution = null;
    }
    if (solution === null || (version !== null && solution.planVersion != null && solution.planVersion !== version)) {
      throw new KardinalOptimizationError(`Plan "${planId}" ended (${state}) without a solution for version ${version}.`, {
        code: "NO_SOLUTION",
        planId,
        planVersion: version,
        state,
      });
    }
    return { ...solution, finalState: state };
  }
}

function deletedError(planId: string): KardinalError {
  return new KardinalNotFoundError(`Plan "${planId}" was deleted while waiting for its solution.`, {
    code: "NOT_FOUND",
    status: 404,
    requestId: null,
    retryable: false,
  });
}
