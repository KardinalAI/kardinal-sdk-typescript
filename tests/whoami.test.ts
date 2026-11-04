import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { Kardinal } from "../src/index.js";
import { DEFAULT_BASE_URL } from "../src/core/transport.js";
import { server } from "./setup.js";
import { typecheck } from "./typecheck.js";

afterEach(() => vi.unstubAllEnvs());

function plansHandler(body: Record<string, unknown>) {
  const seen: URL[] = [];
  server.use(
    http.get(`${DEFAULT_BASE_URL}/plans`, ({ request }) => {
      seen.push(new URL(request.url));
      return HttpResponse.json(body);
    })
  );
  return seen;
}

describe("Kardinal.whoami", () => {
  it("returns the host and the agency the key resolves to", async () => {
    vi.stubEnv("KARDINAL_BASE_URL", "");
    const seen = plansHandler({ agencyId: "A_sandbox", items: [], paging: {} });
    expect(await new Kardinal({ apiKey: "k" }).whoami()).toEqual({
      baseUrl: DEFAULT_BASE_URL,
      agencyId: "A_sandbox",
    });
    expect(Object.fromEntries(seen[0].searchParams)).toEqual({
      page: "1",
      itemsPerPage: "1",
      archived: "excluded",
    });
  });

  it("gives a null agencyId when the response has none", async () => {
    vi.stubEnv("KARDINAL_BASE_URL", "");
    plansHandler({ items: [], paging: {} });
    expect((await new Kardinal({ apiKey: "k" }).whoami()).agencyId).toBeNull();
  });

  it("exports the Whoami type from the package root", () => {
    const diagnostics = typecheck({
      "whoami.ts": `import type { Whoami } from "@kardinal-ai/sdk";
const w: Whoami = { baseUrl: "x", agencyId: null };
export { w };`,
    });
    expect(diagnostics).toEqual([]);
  });
});
