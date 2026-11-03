// Copied from sdks/errors-and-warnings.mdx by scripts/sync-doc-examples.mjs: do not edit by hand.

// --- sdks/errors-and-warnings.mdx:42
import { KardinalLimitError, KardinalValidationError } from "@kardinal-ai/sdk";

try {
  plan = await k.routing.plans.submit(planInput);
} catch (e) {
  if (e instanceof KardinalValidationError) {
    console.log(e.code); // INVALID_VALUE, ID_NOT_UNIQUE, ...
    console.log(e.errors); // every error of the response, not only the first
  } else if (e instanceof KardinalLimitError) {
    console.log(e.details); // which limit was hit
  }
  throw e;
}


// --- sdks/errors-and-warnings.mdx:151
plan = await k.routing.plans.submit(planInput);
for (const warning of plan.warnings) {
  console.log(warning.code, warning.properties); // for example, maxOptimizationDuration clamped
}
