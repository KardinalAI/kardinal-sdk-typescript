#!/usr/bin/env node
/**
 * Root CLI: `version`, `auth check`, `init`, and the `routing` subcommands.
 * Kept as a separate entry point from index.ts on purpose: `main`/`bin`
 * point at different compiled files, so a library-only consumer never
 * loads `commander` (a peer dependency, only needed for the CLI) at all.
 */

import { Command } from "commander";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { Kardinal } from "./index.js";
import { KardinalError } from "./core/errors.js";
import { parsePlanCreate } from "./routing/schemas.js";
import type { Plan } from "./routing/schemas.js";
import { SDK_VERSION } from "./core/version.js";
import { z } from "zod";

const program = new Command();
program.name("kardinal").description("Kardinal CLI.");

function emit(payload: unknown, forceJson: boolean): void {
  const isTty = process.stdout.isTTY;
  if (forceJson || !isTty) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  const rows = Array.isArray(payload) ? payload : [payload];
  for (const row of rows) {
    if (row && typeof row === "object") {
      for (const [key, value] of Object.entries(row)) {
        console.log(`${key.padEnd(24)} ${JSON.stringify(value)}`);
      }
      console.log("");
    } else {
      console.log(String(row));
    }
  }
}

function fail(err: KardinalError): never {
  emit({ code: err.code, message: err.message, details: err.details, retryable: err.retryable }, true);
  process.exit(1);
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

program
  .command("version")
  .description("Package version and the API version it targets.")
  .action(() => {
    console.log(`kardinal ${SDK_VERSION} (API v2)`);
  });

const auth = program.command("auth").description("Diagnose the configured API key.");
auth
  .command("check")
  .description("Confirms the API key authenticates against the configured host, and reports which agency it resolves to.")
  .option("--json", "Force JSON output.")
  .action(async (opts) => {
    const client = new Kardinal();
    try {
      const response = await client._transport.request<{ agencyId?: string }>("GET", "/plans", {
        params: { page: 1, itemsPerPage: 1, archived: "excluded" },
      });
      emit({ valid: true, baseUrl: client._transport.baseUrl, agencyId: response?.agencyId }, !!opts.json);
    } catch (e) {
      if (e instanceof KardinalError) fail(e);
      throw e;
    }
  });

program
  .command("init")
  .description("Drop a short pointer file into the current project.")
  .action(() => {
    mkdirSync(".kardinal", { recursive: true });
    writeFileSync(
      ".kardinal/SKILL.md",
      [
        "# Kardinal SDK",
        "",
        "This project uses the `kardinal` TypeScript SDK for route optimization.",
        "",
        "```ts",
        'import { Kardinal, examples } from "@kardinal-ai/sdk";',
        "",
        "const k = new Kardinal(); // reads KARDINAL_API_KEY",
        "const plan = await k.routing.plans.submit(examples.smallDeliveryPlan());",
        "const solution = await k.routing.solutions.wait(plan.id);",
        "```",
        "",
        "See the package README for the full walkthrough, or run `kardinal --help`.",
        "",
      ].join("\n")
    );
    console.log("Wrote .kardinal/SKILL.md");
  });

const routing = program.command("routing").description("Route optimization.");
const plans = routing.command("plans").description("Submit, retrieve, and update plans.");
const solutions = routing.command("solutions").description("Retrieve a solution and its objectives.");

plans
  .command("submit <file>")
  .description("Submit a new plan and start optimization. Billed in full.")
  .option("--json", "Force JSON output.")
  .action(async (file, opts) => {
    const plan = parsePlanCreate(readJsonFile(file));
    const client = new Kardinal();
    try {
      const created = await client.routing.plans.submit(plan);
      emit(created, !!opts.json);
    } catch (e) {
      if (e instanceof KardinalError) fail(e);
      throw e;
    }
  });

plans
  .command("get <planId>")
  .description("Retrieve a plan by id.")
  .option("--json", "Force JSON output.")
  .action(async (planId, opts) => {
    const client = new Kardinal();
    try {
      emit(await client.routing.plans.get(planId), !!opts.json);
    } catch (e) {
      if (e instanceof KardinalError) fail(e);
      throw e;
    }
  });

plans
  .command("update <file>")
  .description("Update a plan. Re-optimizes if needed; only new unique stops are billed.")
  .option("--json", "Force JSON output.")
  .action(async (file, opts) => {
    const plan = readJsonFile(file) as Plan;
    const client = new Kardinal();
    try {
      emit(await client.routing.plans.update(plan), !!opts.json);
    } catch (e) {
      if (e instanceof KardinalError) fail(e);
      throw e;
    }
  });

plans
  .command("delete <planId>")
  .description("Delete a plan.")
  .action(async (planId) => {
    const client = new Kardinal();
    try {
      await client.routing.plans.delete(planId);
      console.log("OK");
    } catch (e) {
      if (e instanceof KardinalError) fail(e);
      throw e;
    }
  });

plans
  .command("list")
  .description("List plans, one page at a time.")
  .option("--page <n>", "Page number.", "1")
  .option("--items-per-page <n>", "Items per page.", "20")
  .option("--archived <mode>", "excluded | included | only", "excluded")
  .option("--json", "Force JSON output.")
  .action(async (opts) => {
    const client = new Kardinal();
    try {
      const result = await client.routing.plans.list({
        page: Number(opts.page),
        itemsPerPage: Number(opts.itemsPerPage),
        archived: opts.archived,
      });
      emit(result.items, !!opts.json);
    } catch (e) {
      if (e instanceof KardinalError) fail(e);
      throw e;
    }
  });

plans
  .command("start <planId>")
  .description("Restart optimization on a stopped plan.")
  .action(async (planId) => {
    const client = new Kardinal();
    try {
      await client.routing.plans.start(planId);
      console.log("OK");
    } catch (e) {
      if (e instanceof KardinalError) fail(e);
      throw e;
    }
  });

plans
  .command("stop <planId>")
  .description("Stop optimization on a plan without changing its data.")
  .action(async (planId) => {
    const client = new Kardinal();
    try {
      await client.routing.plans.stop(planId);
      console.log("OK");
    } catch (e) {
      if (e instanceof KardinalError) fail(e);
      throw e;
    }
  });

plans
  .command("status <planId>")
  .description("Show the plan's current optimization state.")
  .option("--json", "Force JSON output.")
  .action(async (planId, opts) => {
    const client = new Kardinal();
    try {
      const state = await client.routing.plans.getStatus(planId);
      emit({ state }, !!opts.json);
    } catch (e) {
      if (e instanceof KardinalError) fail(e);
      throw e;
    }
  });

plans
  .command("validate <file>")
  .description("Validate a plan locally. No API call, no credits consumed.")
  .action((file) => {
    try {
      parsePlanCreate(readJsonFile(file));
    } catch (e) {
      if (e instanceof z.ZodError) {
        emit(
          e.issues.map((issue) => ({ field: issue.path.join("."), error: issue.message })),
          true
        );
        process.exit(1);
      }
      throw e;
    }
    console.log("OK");
  });

solutions
  .command("get <planId>")
  .description("Retrieve a plan's solution.")
  .option("--json", "Force JSON output.")
  .action(async (planId, opts) => {
    const client = new Kardinal();
    try {
      emit(await client.routing.solutions.get(planId), !!opts.json);
    } catch (e) {
      if (e instanceof KardinalError) fail(e);
      throw e;
    }
  });

solutions
  .command("objectives <planId>")
  .description("Cheap-to-poll objective values, without the full solution.")
  .option("--json", "Force JSON output.")
  .action(async (planId, opts) => {
    const client = new Kardinal();
    try {
      emit(await client.routing.solutions.getObjectives(planId), !!opts.json);
    } catch (e) {
      if (e instanceof KardinalError) fail(e);
      throw e;
    }
  });

solutions
  .command("wait <planId>")
  .description("Block until the plan finishes optimizing, then print its solution.")
  .option("--timeout-ms <n>", "Hard timeout, in milliseconds.")
  .option("--json", "Force JSON output.")
  .action(async (planId, opts) => {
    const client = new Kardinal();
    try {
      const solution = await client.routing.solutions.wait(
        planId,
        opts.timeoutMs ? Number(opts.timeoutMs) : undefined
      );
      emit(solution, !!opts.json);
    } catch (e) {
      if (e instanceof KardinalError) fail(e);
      throw e;
    }
  });

routing
  .command("demo")
  .description("Submit the example plan and wait for its solution.")
  .option("--json", "Force JSON output.")
  .action(async (opts) => {
    const client = new Kardinal();
    const { examples } = await import("./index.js");
    try {
      const plan = await client.routing.plans.submit(examples.smallDeliveryPlan());
      // Printed before wait(), not after, and to stderr so --json output
      // stays clean: submit() already billed this plan, so its id must
      // reach the user even if wait() itself times out or the connection
      // drops.
      console.error(`Submitted plan ${plan.id}`);
      const solution = await client.routing.solutions.wait(plan.id);
      emit(solution, !!opts.json);
    } catch (e) {
      if (e instanceof KardinalError) fail(e);
      throw e;
    }
  });

program.parseAsync(process.argv);
