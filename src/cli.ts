#!/usr/bin/env node
/**
 * Root CLI: `version`, `auth check`, `init`, and the `routing` subcommands
 * — a word-for-word projection of the SDK surface
 * (`k.routing.plans.submit` -> `kardinal routing plans submit`), plus
 * `validate` and `demo`, which aren't.
 *
 * Kept as a separate entry point from index.ts on purpose: `main`/`bin`
 * point at different compiled files, so a library-only consumer never
 * loads `commander` (a peer dependency, only needed for the CLI) at all.
 *
 * Exit codes: 0 on success, 1 for a business error (the API refused, or
 * the plan is invalid: printed as JSON on stdout), 2 for a usage error
 * (unknown command or option, bad option value, missing file).
 */

import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Kardinal } from "./index.js";
import { KardinalError, UnknownFieldError, hintFor } from "./core/errors.js";
import { userAgent } from "./core/transport.js";
import { parsePlan, parsePlanCreate, unknownFields } from "./routing/schemas.js";
import { SDK_VERSION } from "./core/version.js";
import { z } from "zod";

const Exit = { OK: 0, BUSINESS_ERROR: 1, USAGE_ERROR: 2 } as const;

/** `new Kardinal()` for a CLI command: same configuration (environment
 * variables), with `cli;` in the User-Agent so the backend can tell CLI
 * usage apart from library usage. */
function cliClient(): Kardinal {
  const client = new Kardinal({ onWarning: warn });
  client._transport.userAgent = userAgent({ cli: true });
  return client;
}

/** Drops `null`/`undefined` fields, recursively: what the Python CLI prints
 * for a model (`exclude_none`). */
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => [k, withoutNulls(v)])
    );
  }
  return value;
}

/** JSON when stdout isn't a terminal or `--json` was passed, a readable
 * table otherwise — serves both a human and a script without a flag in the
 * common case, and keeps the CLI chainable. */
export function emit(payload: unknown, forceJson = false): void {
  if (forceJson || !process.stdout.isTTY) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  const rows = Array.isArray(payload) ? payload : [payload];
  for (const row of rows) {
    if (row && typeof row === "object") {
      for (const [key, value] of Object.entries(row)) {
        console.log(`${key.padEnd(24)} ${typeof value === "string" ? value : JSON.stringify(value)}`);
      }
      console.log("");
    } else {
      console.log(String(row));
    }
  }
}

/** Thrown to leave a command with an exit code, once its output is printed. */
class ExitRequest extends Error {
  constructor(readonly exitCode: number) {
    super(`exit ${exitCode}`);
  }
}

/** Translates an SDK error into CLI output. The only place an error gets
 * formatted — no command formats one itself. */
export function fail(err: KardinalError): never {
  emit({ code: err.code, message: err.message, details: err.details, retryable: err.retryable }, true);
  throw new ExitRequest(Exit.BUSINESS_ERROR);
}

/** Prints every problem found in a plan file, one `{field, error}` each. */
function failValidation(issues: { field: string; error: string }[]): never {
  emit(issues, true);
  throw new ExitRequest(Exit.BUSINESS_ERROR);
}

/** An unknown key as a `{ field, error }` issue, the shape every other
 * local validation problem is printed in. */
function describeUnknown(field: {
  path: string;
  suggestion?: string;
  serverAssigned?: boolean;
}): { field: string; error: string } {
  const hint = hintFor(field);
  return {
    field: field.path.replace(/^plan\./, ""),
    error: hint ? `Unknown field — ${hint}` : "Unknown field",
  };
}

/** `--allow-unknown NAME`, repeatable: send a key this SDK version doesn't
 * know, for a field the API gained since. Everything else stays checked. */
const allowUnknownOption = () =>
  new Option(
    "--allow-unknown <name>",
    "Send an unknown field instead of refusing it. Repeatable."
  ).argParser((value: string, previous: string[] = []) => previous.concat(value));

/** Reports a typo on a plan the SDK couldn't check exactly, in the CLI's own
 * format on stderr rather than as a bare `console.warn`, so it reads like
 * every other message the CLI prints and never lands in `--json` output. */
function warn(message: string): void {
  process.stderr.write(`warning: ${message}\n`);
}

/** A Zod issue as `{field, error}`, worded like the Python CLI's (pydantic)
 * for a missing field and an unknown one, which it reports field by field. */
function describeIssue(issue: z.ZodIssue): { field: string; error: string }[] {
  const field = (path: (string | number)[]) => path.join(".");
  if (issue.code === "invalid_type" && issue.received === "undefined") {
    return [{ field: field(issue.path), error: "Field required" }];
  }
  return [{ field: field(issue.path), error: issue.message }];
}

/** Runs a command body, translating the errors a user can cause (API
 * refusal, invalid plan file) into clean JSON output and exit code 1. */
async function run(body: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await body();
  } catch (e) {
    if (e instanceof UnknownFieldError) failValidation(e.fields.map(describeUnknown));
    if (e instanceof KardinalError) fail(e);
    if (e instanceof z.ZodError) failValidation(e.issues.flatMap(describeIssue));
    if (e instanceof SyntaxError) failValidation([{ field: "", error: `Invalid JSON: ${e.message}` }]);
    throw e;
  }
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** A `<file>` argument that must exist (a usage error otherwise). */
function existingFile(path: string): string {
  if (!existsSync(path)) throw new InvalidArgumentError(`File '${path}' does not exist.`);
  return path;
}

function integer(value: string): number {
  const n = Number(value);
  if (value.trim() === "" || !Number.isInteger(n)) {
    throw new InvalidArgumentError(`'${value}' is not a valid integer.`);
  }
  return n;
}

function seconds(value: string): number {
  const n = Number(value);
  if (value.trim() === "" || !Number.isFinite(n)) {
    throw new InvalidArgumentError(`'${value}' is not a valid number.`);
  }
  return n;
}

const forceOption = () => new Option("--force", "Unarchive the plan first, if archived.");

/** A fresh command tree: commander keeps parsed option values on the
 * `Command` objects, so each `main()` call builds its own. */
function buildProgram(): Command {
  const program = new Command();
  program.name("kardinal").description("Kardinal CLI.").exitOverride();

  program
    .command("version")
    .description("Package version and the API version it targets.")
    .action(() => {
      const version = SDK_VERSION === "unknown" ? "unknown (not installed as a package)" : SDK_VERSION;
      console.log(`kardinal ${version} (API v2)`);
    });

  const auth = program.command("auth").description("Diagnose the configured API key.");
  auth
    .command("check")
    .description(
      "The first thing to run when nothing else works: confirms the API key works, and reports the " +
        "host it was checked against and the agency (sandbox or production) it resolves to."
    )
    .option("--json", "Force JSON output.")
    .action((opts) =>
      run(async () => {
        const client = cliClient();
        const response = await client._transport.request<{ agencyId?: string }>("GET", "/plans", {
          params: { page: 1, itemsPerPage: 1, archived: "excluded" },
        });
        emit(
          { valid: true, baseUrl: client._transport.baseUrl, agencyId: response?.agencyId ?? null },
          !!opts.json
        );
      })
    );

  program
    .command("init")
    .description(
      "Drop a short pointer file into the current project, so an AI coding assistant working in this " +
        "repo knows this SDK is available."
    )
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
          "Documentation: https://www.npmjs.com/package/@kardinal-ai/sdk (or run `kardinal --help`).",
          "",
        ].join("\n")
      );
      console.log("Wrote .kardinal/SKILL.md");
    });

  const routing = program.command("routing").description("Route optimization.");
  const plans = routing.command("plans").description("Submit, retrieve, and update plans.");
  const solutions = routing.command("solutions").description("Retrieve a solution and its objectives.");

  plans
    .command("submit")
    .description("Submit a new plan and start optimization. Billed in full.")
    .argument("<file>", "JSON file with the plan.", existingFile)
    .addOption(allowUnknownOption())
    .option("--json", "Force JSON output.")
    .action((file, opts) =>
      run(async () => {
        const allowUnknown: string[] = opts.allowUnknown ?? [];
        const plan = parsePlanCreate(readJsonFile(file), allowUnknown);
        const submitted = await cliClient().routing.plans.submit(plan, { allowUnknown });
        emit(withoutNulls(submitted), !!opts.json);
      })
    );

  plans
    .command("get <planId>")
    .description("Retrieve a plan by id.")
    .option("--json", "Force JSON output.")
    .action((planId, opts) =>
      run(async () => emit(withoutNulls(await cliClient().routing.plans.get(planId)), !!opts.json))
    );

  plans
    .command("update")
    .description("Update a plan. Re-optimizes if needed; only new unique stops are billed.")
    .argument("<file>", "JSON file with the full plan, including its id.", existingFile)
    .addOption(forceOption())
    .addOption(allowUnknownOption())
    .option("--json", "Force JSON output.")
    .action((file, opts) =>
      run(async () => {
        const plan = parsePlan(readJsonFile(file));
        const client = cliClient();
        // A plan from a file carries no provenance, so `update()` could only
        // warn about a typo and would send it anyway. Reading the stored plan
        // first lends it the provenance that turns the warning into a refusal.
        // Deliberately best-effort: this read only sharpens a check the
        // command already makes, and `update()` reports a real failure (a
        // missing plan, a bad key) on its own a moment later.
        try {
          await client.routing.plans.get(plan.id);
        } catch {
          // fall through to the weaker check
        }
        const updated = await client.routing.plans.update(plan, {
          force: !!opts.force,
          allowUnknown: opts.allowUnknown ?? [],
        });
        emit(withoutNulls(updated), !!opts.json);
      })
    );

  plans
    .command("delete <planId>")
    .description("Delete a plan.")
    .action((planId) =>
      run(async () => {
        await cliClient().routing.plans.delete(planId);
        console.log("OK");
      })
    );

  plans
    .command("list")
    .description("List plans, one page at a time.")
    .option("--page <n>", "Page number.", integer, 1)
    .option("--items-per-page <n>", "Items per page.", integer, 20)
    .addOption(
      new Option("--archived <mode>", "Which plans to list.")
        .choices(["excluded", "included", "only"])
        .default("excluded")
    )
    .option("--json", "Force JSON output.")
    .action((opts) =>
      run(async () => {
        const result = await cliClient().routing.plans.list({
          page: opts.page,
          itemsPerPage: opts.itemsPerPage,
          archived: opts.archived,
        });
        emit(withoutNulls(result.items), !!opts.json);
      })
    );

  plans
    .command("start <planId>")
    .description("Restart optimization on a stopped plan.")
    .addOption(forceOption())
    .option("--json", "Force JSON output.")
    .action((planId, opts) =>
      run(async () => {
        const reference = await cliClient().routing.plans.start(planId, { force: !!opts.force });
        emit(withoutNulls(reference), !!opts.json);
      })
    );

  plans
    .command("stop <planId>")
    .description("Stop optimization on a plan without changing its data.")
    .addOption(forceOption())
    .option("--json", "Force JSON output.")
    .action((planId, opts) =>
      run(async () => {
        const reference = await cliClient().routing.plans.stop(planId, { force: !!opts.force });
        emit(withoutNulls(reference), !!opts.json);
      })
    );

  plans
    .command("status <planId>")
    .description("Show the plan's current optimization state.")
    .option("--json", "Force JSON output.")
    .action((planId, opts) =>
      run(async () => emit({ state: await cliClient().routing.plans.getStatus(planId) }, !!opts.json))
    );

  plans
    .command("validate")
    .description("Validate a plan locally. No API call, no credits consumed.")
    .argument("<file>", "JSON file with the plan.", existingFile)
    .addOption(allowUnknownOption())
    .action((file, opts) =>
      run(() => {
        const data = readJsonFile(file);
        const allowUnknown: string[] = opts.allowUnknown ?? [];
        try {
          // The same check submit() makes, so this can't answer OK to a plan
          // submit() goes on to refuse.
          parsePlanCreate(data, allowUnknown);
        } catch (e) {
          // A malformed plan usually has more than one problem, and a
          // misspelled key is often one of them. parsePlanCreate reports a
          // malformed value first, so pair it with the unknown keys here
          // rather than sending the caller round the loop twice. An
          // UnknownFieldError means there was nothing else to say, and
          // `run()` prints it in the same shape.
          if (e instanceof z.ZodError) {
            const allowed = new Set(allowUnknown);
            failValidation([
              ...e.issues.flatMap(describeIssue),
              ...unknownFields(data)
                .filter((f) => !allowed.has(f.key))
                .map(describeUnknown),
            ]);
          }
          throw e;
        }
        console.log("OK");
      })
    );

  solutions
    .command("get <planId>")
    .description("Retrieve a plan's solution.")
    .option("--json", "Force JSON output.")
    .action((planId, opts) =>
      run(async () => emit(withoutNulls(await cliClient().routing.solutions.get(planId)), !!opts.json))
    );

  solutions
    .command("objectives <planId>")
    .description("Objective values only, without the full solution.")
    .option("--json", "Force JSON output.")
    .action((planId, opts) =>
      run(async () => {
        const objectives = await cliClient().routing.solutions.getObjectives(planId);
        emit(withoutNulls([...objectives]), !!opts.json);
      })
    );

  solutions
    .command("wait <planId>")
    .description("Block until the plan finishes optimizing, then print its solution.")
    .option("--timeout <seconds>", "Hard timeout, in seconds.", seconds)
    .option("--json", "Force JSON output.")
    .action((planId, opts) =>
      run(async () => {
        const timeoutMs = opts.timeout === undefined ? undefined : opts.timeout * 1000;
        emit(withoutNulls(await cliClient().routing.solutions.wait(planId, timeoutMs)), !!opts.json);
      })
    );

  routing
    .command("demo")
    .description("Submit the example plan and wait for its solution.")
    .option("--json", "Force JSON output.")
    .action((opts) =>
      run(async () => {
        const { examples } = await import("./index.js");
        const client = cliClient();
        const plan = await client.routing.plans.submit(examples.smallDeliveryPlan());
        // Printed before wait(), not after, and to stderr so --json output
        // stays clean: submit() already billed this plan, so its id must
        // reach the user even if wait() itself times out or the connection
        // drops.
        console.error(`Submitted plan ${plan.id}`);
        emit(withoutNulls(await client.routing.solutions.wait(plan.id)), !!opts.json);
      })
    );

  return program;
}

/** Parses `argv` (user arguments only, without `node` and the script) and
 * runs the command; resolves to the process exit code. */
export async function main(argv: string[]): Promise<number> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv, { from: "user" });
    return Exit.OK;
  } catch (e) {
    if (e instanceof ExitRequest) return e.exitCode;
    if (e instanceof CommanderError) {
      // `--help` exits cleanly; every other commander exit (unknown command
      // or option, bad value, no arguments or missing subcommand, which
      // print the help) is a usage error.
      return e.exitCode === 0 ? Exit.OK : Exit.USAGE_ERROR;
    }
    throw e;
  }
}

// Run only when executed as the `kardinal` command, not when imported (tests).
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
