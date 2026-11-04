// Copied from guides/multi-day.mdx by scripts/sync-doc-examples.mjs: do not edit by hand.

// --- guides/multi-day.mdx:189
import type { PlanCreateInput } from "@kardinal-ai/sdk";

const paris = { lon: 2.36, lat: 48.75 };

function night(begin: string, end: string) {
  return { type: "timeWindowBreak" as const, duration: "PT11H", timeWindow: { begin, end } };
}

function delivery(name: string, lon: number, lat: number, begin: string, end: string) {
  return {
    id: `order-${name}`,
    priority: 0,
    stops: [
      {
        type: "single" as const,
        id: `stop-${name}`,
        kind: "delivery" as const,
        position: { lon, lat },
        operationDuration: "PT30M",
        authorizedTimeWindows: [{ begin, end }],
      },
    ],
  };
}

const plan: PlanCreateInput = {
  tz: "Europe/Paris",
  maxOptimizationDuration: "PT5S",
  resources: [
    {
      id: "truck-1",
      priority: 0,
      vehicleProfile: { type: "truck" },
      workingTimeWindow: { begin: "2026-11-09 06:00", end: "2026-11-11 20:00" },
      departure: paris,
      arrival: paris,
      breaks: [
        night("2026-11-09 19:00", "2026-11-10 07:00"),
        night("2026-11-10 19:00", "2026-11-11 07:00"),
      ],
    },
  ],
  orders: [
    delivery("lyon", 4.85, 45.75, "2026-11-09 14:00", "2026-11-09 18:00"),
    delivery("marseille", 5.37, 43.3, "2026-11-10 10:00", "2026-11-10 14:00"),
    delivery("montpellier", 3.88, 43.61, "2026-11-10 15:00", "2026-11-10 19:00"),
    delivery("clermont", 3.09, 45.78, "2026-11-11 10:00", "2026-11-11 14:00"),
  ],
};


// --- guides/multi-day.mdx:302
type WayPoint = {
  type: string;
  arrivalTime?: string;
  departureTime?: string;
  fromPrevious?: { travelDuration?: string };
};

// Return the calendar day of an ISO 8601 time, in the zone of the plan.
function localDay(text: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(text));
}

// Return the nights where the vehicle doesn't rest.
function checkNights(tour: { wayPoints: WayPoint[] }, tz: string): string[] {
  const problems: string[] = [];
  let previous: string | undefined;
  let rested = false;
  for (const point of tour.wayPoints) {
    if (point.type === "break") {
      if (point.fromPrevious?.travelDuration !== "PT0S") {
        problems.push(`the break at ${point.arrivalTime} comes after a drive`);
      }
      if (localDay(point.departureTime!, tz) > localDay(point.arrivalTime!, tz)) rested = true;
      continue;
    }
    const day = localDay((point.arrivalTime ?? point.departureTime)!, tz);
    if (previous && day > previous && !rested) {
      problems.push(`no rest between the stop reached on ${previous} and the one reached on ${day}`);
    }
    previous = day;
    rested = false;
  }
  return problems;
}
