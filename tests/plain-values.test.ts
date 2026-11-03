/**
 * Plan states, waypoints and ids reach the reader as plain strings and
 * numbers, never as wrapped objects (`{ value: ... }`, `{ root: ... }`), at
 * runtime and in the types an editor shows. Mirrors the Python SDK's
 * `test_plain_values.py`.
 */
import { expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./setup.js";
import { Kardinal } from "../src/index.js";
import { typecheck } from "./typecheck.js";

const BASE = "https://app.kardinal.ai/api/v2";
const PLAN_ID = "4cbd0ab8-282c-4b30-b981-29e1ed8a2016";
const AGENCY_ID = "agency-1";
const POSITION = { latitude: 48.85, longitude: 2.35 };

const client = () => new Kardinal({ apiKey: "test-key" });

function fakeApi() {
  server.use(
    http.get(`${BASE}/plans/${PLAN_ID}/state`, () => HttpResponse.json({ item: { state: "optimized" } })),
    http.get(`${BASE}/plans/${PLAN_ID}`, () =>
      HttpResponse.json({ item: { id: PLAN_ID, agencyId: AGENCY_ID, version: 1, resources: [] } })
    ),
    http.get(`${BASE}/plans/${PLAN_ID}/solution`, () =>
      HttpResponse.json({
        item: {
          planId: PLAN_ID,
          planVersion: 1,
          tours: [
            {
              resourceId: "truck-1",
              wayPoints: [
                { type: "begin", position: POSITION },
                { type: "stop", stopId: "stop-1", position: POSITION },
                { type: "break", position: POSITION },
                { type: "stop", stopId: "stop-2", position: POSITION },
                { type: "end", position: POSITION },
              ],
            },
          ],
        },
      })
    )
  );
}

it("the state of a plan is the string 'optimized'", async () => {
  fakeApi();
  const state = await client().routing.plans.getStatus(PLAN_ID);
  expect(state === "optimized").toBe(true);
  expect(typeof state).toBe("string");
});

it("stop ids read from the waypoints of a tour are strings", async () => {
  fakeApi();
  const solution = await client().routing.solutions.get(PLAN_ID);
  const tour = solution.tours![0];
  const stopIds = (tour.wayPoints ?? []).filter((wp) => wp.type === "stop").map((wp) => (wp as { stopId?: string }).stopId);
  expect(stopIds).toEqual(["stop-1", "stop-2"]);
  expect(stopIds.every((id) => typeof id === "string")).toBe(true);
});

it("ids and the version of a plan serialize as a bare string and a bare number", async () => {
  fakeApi();
  const plan = await client().routing.plans.get(PLAN_ID);
  expect(JSON.stringify(plan.version)).toBe("1");
  expect(JSON.stringify(plan.agencyId)).toBe(JSON.stringify(AGENCY_ID));
  const solution = await client().routing.solutions.get(PLAN_ID);
  const stop = solution.tours![0].wayPoints!.find((wp) => wp.type === "stop") as { stopId?: string };
  expect(JSON.stringify(stop.stopId)).toBe('"stop-1"');
});

const HEAD = `import { Kardinal } from "@kardinal-ai/sdk";
declare const k: Kardinal;
export async function main() {
  const state = await k.routing.plans.getStatus("p");
  const plan = await k.routing.plans.get("p");
  const solution = await k.routing.solutions.get("p");
  for (const wp of solution.tours![0].wayPoints ?? []) {
    if (wp.type !== "stop") continue;
`;
const TAIL = `  }\n}\n`;

it("states, ids and versions have plain types in the editor", () => {
  const good = `${HEAD}
    const id: string | undefined = wp.stopId;
    const v: number | undefined = plan.version;
    const a: string | undefined = plan.agencyId;
    const s: string = state;
    if (state === "optimized") console.log(id, v, a, s);
${TAIL}`;
  expect(typecheck({ "good.ts": good })).toEqual([]);
});

it("the type check notices a state that is not a string (negative control)", () => {
  const bad = `${HEAD}    const wrong: number = state;\n    console.log(wrong);\n${TAIL}`;
  expect(typecheck({ "bad.ts": bad }).join("\n")).toMatch(/bad\.ts:\d+ .*not assignable to type 'number'/);
});

it("the type check notices a stop id that is not a string (negative control)", () => {
  const bad = `${HEAD}    const wrong: number = wp.stopId;\n    console.log(wrong);\n${TAIL}`;
  expect(typecheck({ "bad.ts": bad }).join("\n")).toMatch(/bad\.ts:\d+ .*not assignable to type 'number'/);
});
