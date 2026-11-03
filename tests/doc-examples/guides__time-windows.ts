// Copied from guides/time-windows.mdx by scripts/sync-doc-examples.mjs: do not edit by hand.

// --- guides/time-windows.mdx:179
import type { PlanCreateInput } from "@kardinal-ai/sdk";

const depot = { lon: 2.35, lat: 48.85 };

const plan: PlanCreateInput = {
  tz: "Europe/Paris",
  maxOptimizationDuration: "PT5S",
  resources: [
    {
      id: "van-1",
      priority: 0,
      vehicleProfile: { type: "car" },
      workingTimeWindow: { begin: "2026-10-29 08:00", end: "2026-10-29 20:00" },
      departure: depot,
      arrival: depot,
    },
  ],
  orders: [
    {
      id: "order-clinic",
      priority: 0,
      stops: [
        {
          type: "single",
          id: "stop-clinic",
          kind: "delivery",
          position: { lon: 2.36, lat: 48.855 },
          operationDuration: "PT10M",
          authorizedTimeWindows: [
            { begin: "2026-10-29 08:00", end: "2026-10-29 09:00", resourceTags: ["certified"] },
            { begin: "2026-10-29 10:00", end: "2026-10-29 12:00" },
          ],
        },
      ],
    },
    {
      id: "order-shop",
      priority: 0,
      stops: [
        {
          type: "single",
          id: "stop-shop",
          kind: "delivery",
          position: { lon: 2.34, lat: 48.845 },
          operationDuration: "PT10M",
          preferredTimeWindows: [{ begin: "2026-10-29 06:00", end: "2026-10-29 06:30" }],
        },
      ],
    },
  ],
};


// --- guides/time-windows.mdx:311
import type { PlanCreateInput, WaitedSolution } from "@kardinal-ai/sdk";

// Reads "2026-10-29 10:00" in the plan's tz, or "2026-10-29T10:00:00+01:00" as is.
function instant(text: string, tz: string): number {
  if (/(Z|[+-]\d\d:\d\d)$/.test(text)) return Date.parse(text);
  const asUtc = Date.parse(`${text.replace(" ", "T")}Z`);
  const shown = new Date(asUtc).toLocaleString("sv-SE", { timeZone: tz });
  return asUtc - (Date.parse(`${shown.replace(" ", "T")}Z`) - asUtc);
}

export function check(plan: PlanCreateInput, solution: WaitedSolution): void {
  const tz = plan.tz ?? "UTC";
  const stops = new Map((plan.orders ?? []).flatMap((o) => o.stops).map((s) => [s.id, s] as const));
  const tags = new Map((plan.resources ?? []).map((r) => [r.id, new Set(r.tags ?? [])] as const));

  for (const stopId of solution.unaffectedStopIds ?? []) console.log(stopId, "was not planned");

  for (const tour of solution.tours ?? []) {
    for (const wp of tour.wayPoints ?? []) {
      if (wp.type !== "stop" || !wp.beginTime) continue;
      const stop = stops.get(wp.stopId ?? "");
      if (stop?.type !== "single") continue;
      const begin = instant(wp.beginTime, tz);
      const applying = (stop.authorizedTimeWindows ?? []).filter(
        (w) => !w.resourceTags?.length || w.resourceTags.some((t) => tags.get(tour.resourceId ?? "")?.has(t)),
      );
      const inside =
        (stop.authorizedTimeWindows ?? []).length === 0 ||
        applying.some((w) => instant(w.begin, tz) <= begin && begin <= instant(w.end, tz));
      console.log(stop.id, inside ? "authorized: ok" : "authorized: OUTSIDE", "delay:", wp.delay);
    }
  }
}
