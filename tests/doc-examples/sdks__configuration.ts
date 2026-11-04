// Copied from sdks/configuration.mdx by scripts/sync-doc-examples.mjs: do not edit by hand.

// --- sdks/configuration.mdx:18
import { Kardinal } from "@kardinal-ai/sdk";

const k = new Kardinal(); // { apiKey, baseUrl, timeoutMs: 30_000, maxRetries: 3 }


// --- sdks/configuration.mdx:73
const who = await k.whoami(); // { baseUrl, agencyId }
console.log(who.baseUrl, who.agencyId);
const expectedAgency = "A_sandbox"; // read it from your own configuration
if (who.agencyId !== expectedAgency) {
  throw new Error(`This API key belongs to ${who.agencyId}, not to ${expectedAgency}`);
}
