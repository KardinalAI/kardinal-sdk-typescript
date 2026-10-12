import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { UnknownFieldError } from "../src/core/errors.js";
import { parsePlanCreate, orderSchema, unknownFields } from "../src/routing/schemas.js";

const stop = { type: "single" as const, id: "s1", position: { lat: 48.85, lon: 2.35 } };

describe("parsePlanCreate", () => {
  it("rejects an empty plan (missing resources)", () => {
    expect(() => parsePlanCreate({})).toThrow(z.ZodError);
  });

  it("reports an unknown field at the top level", () => {
    const found = unknownFields({ resources: [{ id: "r1" }], bogusField: 123 });
    expect(found.map((f) => f.path)).toEqual(["plan.bogusField"]);
  });

  it("reports a client-supplied id rather than letting it through", () => {
    // PlanCreate has no `id`: the server assigns one. Sending an `id` anyway
    // is not refused by the API — it answers 201 with a different id — so a
    // caller reusing the one they sent would address a plan that doesn't
    // exist. submit() refuses it instead.
    const found = unknownFields({ id: "should-not-exist", resources: [{ id: "r1" }] });
    expect(found.map((f) => f.path)).toEqual(["plan.id"]);
  });

  it("accepts a minimal valid plan", () => {
    const plan = parsePlanCreate({
      resources: [
        {
          id: "r1",
          vehicleProfile: { type: "car" },
          workingTimeWindow: { begin: "2026-10-01T08:00:00Z", end: "2026-10-01T18:00:00Z" },
        },
      ],
    });
    expect(plan.resources).toHaveLength(1);
    expect(plan.lateDeparture).toBe(false); // default applied
  });

  it("reports every problem, not just the first", () => {
    try {
      parsePlanCreate({ resources: "not-a-list" });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(z.ZodError);
    }
  });
});

describe("orderSchema (stops discriminator fix)", () => {
  it("keeps the `type` field on stops, unlike the generated Omit<Stop, 'type'>[] type", () => {
    const order = orderSchema.parse({
      id: "o1",
      priority: 0,
      stops: [{ type: "single", id: "s1", position: { lat: 48.85, lon: 2.35 } }],
    });
    expect(order.stops[0].type).toBe("single");
  });

  it("rejects a stop missing the required type discriminator", () => {
    expect(() =>
      orderSchema.parse({
        id: "o1",
        priority: 0,
        stops: [{ id: "s1", position: { lat: 48.85, lon: 2.35 } }],
      })
    ).toThrow(z.ZodError);
  });
});

describe("parsePlanCreate (rules shared with the Python SDK)", () => {
  const resource = {
    id: "r1",
    vehicleProfile: { type: "car" },
    workingTimeWindow: { begin: "2026-10-01T08:00:00Z", end: "2026-10-01T18:00:00Z" },
  };
  const order = (fields: Record<string, unknown>) => ({
    id: "o1",
    stops: [{ type: "single", id: "s1", position: { lat: 48.85, lon: 2.35 } }],
    ...fields,
  });

  it("accepts empty resources and stops, like openapi.yaml (no minItems)", () => {
    expect(() => parsePlanCreate({ resources: [], orders: [order({ stops: [] })] })).not.toThrow();
  });

  it("rejects an id outside the allowed characters", () => {
    expect(() => parsePlanCreate({ resources: [{ ...resource, id: "r 1" }] })).toThrow(z.ZodError);
    expect(() => parsePlanCreate({ resources: [], orders: [order({ id: "é" })] })).toThrow(z.ZodError);
  });

  it("rejects a malformed ISO 8601 duration", () => {
    expect(() => parsePlanCreate({ resources: [], maxOptimizationDuration: "10s" })).toThrow(z.ZodError);
    expect(() => parsePlanCreate({ resources: [], orders: [order({ maxStopSpan: "1h" })] })).toThrow(z.ZodError);
  });

  it("rejects a non-integer priority", () => {
    expect(() => parsePlanCreate({ resources: [], orders: [order({ priority: 1.5 })] })).toThrow(z.ZodError);
    expect(() => parsePlanCreate({ resources: [{ ...resource, priority: 0.5 }] })).toThrow(z.ZodError);
  });

  it("rejects an unknown vehicle profile type", () => {
    expect(() => parsePlanCreate({ resources: [{ ...resource, vehicleProfile: { type: "boat" } }] })).toThrow(
      z.ZodError
    );
  });

  it("refuses an unknown resource field, and keeps one the caller allows", () => {
    // Dropping it silently is what made a misspelled optional field
    // undetectable: the plan was sent without it and came back valid.
    expect(() => parsePlanCreate({ resources: [{ ...resource, bogus: 1 }] })).toThrow(
      UnknownFieldError,
    );
    const plan = parsePlanCreate({ resources: [{ ...resource, bogus: 1 }] }, ["bogus"]);
    expect(plan.resources[0]).toHaveProperty("bogus");
    expect(plan.resources[0].priority).toBe(0);
  });

  it("reports an unknown field at every level, with a suggestion", () => {
    const found = unknownFields({
      objectivs: {},
      resources: [{ ...resource, maxWorkingDurationn: "PT8H" }],
      orders: [
        { id: "o1", prioritty: 2, stops: [{ ...stop, operationDurationn: "PT5M" }] },
      ],
    });
    expect(found.map((f) => f.path).sort()).toEqual([
      "plan.objectivs",
      "plan.orders[0].prioritty",
      "plan.orders[0].stops[0].operationDurationn",
      "plan.resources[0].maxWorkingDurationn",
    ]);
    expect(found.find((f) => f.key === "maxWorkingDurationn")?.suggestion).toBe("maxWorkingDuration");
  });

  it("says nothing about a free-form map or a plausible future API field", () => {
    expect(
      unknownFields({
        resources: [{ ...resource, capacities: { anything: 3 }, properties: { free: "form" } }],
      }),
    ).toEqual([]);
    // Four edits from maxWorkingDuration: a field the API could add, not a slip.
    const future = unknownFields({ resources: [{ ...resource, maxDrivingDuration: "PT4H" }] });
    expect(future[0].suggestion).toBeUndefined();
  });
});

describe("the shapes a key can hide in", () => {
  const tw = { begin: "2026-10-09T08:00:00Z", end: "2026-10-09T18:00:00Z" };
  const res = { id: "r1", vehicleProfile: { type: "car" as const }, workingTimeWindow: tw };

  it("keeps an unknown key in every nested object, not just the time window", () => {
    // Each of these dropped silently until this MR, so a key `allowUnknown`
    // was asked to send never left.
    const cases: Array<[string, Record<string, unknown>]> = [
      ["position", { ...res, departure: { lat: 48.85, lon: 2.35, newKey: 1 } }],
      ["timeWindow", { ...res, workingTimeWindow: { ...tw, newKey: 1 } }],
    ];
    for (const [label, resource] of cases) {
      const found = unknownFields({ resources: [resource] });
      expect(found.map((f) => f.key), label).toEqual(["newKey"]);
      const parsed: any = parsePlanCreate({ resources: [resource] }, ["newKey"]);
      expect(JSON.stringify(parsed), label).toContain("newKey");
    }
  });

  it("keeps an unknown key in a stop's tagged time window", () => {
    const stopWithWindow = {
      ...stop,
      authorizedTimeWindows: [{ ...tw, resourceTags: ["x"], newKey: 1 }],
    };
    const plan = { resources: [res], orders: [{ id: "o1", stops: [stopWithWindow] }] };
    expect(unknownFields(plan).map((f) => f.path)).toEqual([
      "plan.orders[0].stops[0].authorizedTimeWindows[0].newKey",
    ]);
    expect(JSON.stringify(parsePlanCreate(plan, ["newKey"]))).toContain("newKey");
  });

  it("accepts every documented key of the per-segment bound, and only those", () => {
    // Pinning all three: dropping one from the schema would turn a valid
    // plan into a refused one, which is worse than missing a typo.
    for (const key of ["firstTravel", "interStop", "lastTravel"]) {
      expect(unknownFields({ resources: [{ ...res, maxInterStopDuration: { [key]: "PT1H" } }] }), key).toEqual([]);
      expect(unknownFields({ resources: [{ ...res, maxInterStopDistanceInKm: { [key]: 10 } }] }), key).toEqual([]);
    }
    expect(unknownFields({ resources: [{ ...res, maxInterStopDuration: { lastTravl: "PT1H" } }] })).toHaveLength(1);
  });

  it("resolves a discriminated stop to its own branch", () => {
    // Without the discriminator half of the branch picker, `alternatives`
    // is reported as unknown on every alternatives stop.
    const plan = {
      resources: [res],
      orders: [{ id: "o1", stops: [{ id: "alt1", type: "alternatives", alternatives: [stop] }] }],
    };
    expect(unknownFields(plan)).toEqual([]);
  });

  it("checks a vehicle profile against the variant its type selects", () => {
    // `vehicleProfile` is a oneOf of VehicleProfile* schemas, discriminated
    // by `type`. Read from the spec, so a field it gains fails here, not on
    // a user's plan: every option of every variant used to be reported as
    // unknown (`withTraffic` on a car, `grossWeight` on a truck).
    const schemas = (yaml.load(readFileSync("spec/openapi.yaml", "utf8")) as any).components.schemas;
    const sample = (property: any): unknown => {
      const ref = property.allOf?.[0]?.$ref ?? property.items?.allOf?.[0]?.$ref;
      const target = ref ? schemas[ref.split("/").pop()] : property;
      if (property.type === "array" || target.type === "array") return [target.enum?.[0] ?? target.example?.[0]];
      if (target.enum) return target.enum[0];
      return target.type === "boolean" ? true : 1;
    };
    const variants = Object.keys(schemas).filter((name) => name.startsWith("VehicleProfile"));
    expect(variants).toHaveLength(7);
    for (const name of variants) {
      const { properties } = schemas[name];
      const profile = Object.fromEntries(
        Object.entries(properties).map(([key, property]) => [key, key === "type" ? (property as any).enum[0] : sample(property)]),
      );
      const plan = { resources: [{ ...res, vehicleProfile: profile }] };
      expect(unknownFields(plan), name).toEqual([]);
      expect(() => parsePlanCreate(plan), name).not.toThrow();
    }
  });

  it("still reports a typo inside a vehicle profile, and an option of another variant", () => {
    const found = unknownFields({ resources: [{ ...res, vehicleProfile: { type: "truck", grossWieght: 40000 } }] });
    expect(found).toEqual([
      { path: "plan.resources[0].vehicleProfile.grossWieght", key: "grossWieght", suggestion: "grossWeight" },
    ]);
    // `grossWeight` is a truck option: a car doesn't have it.
    expect(
      unknownFields({ resources: [{ ...res, vehicleProfile: { type: "car", grossWeight: 40000 } }] }).map((f) => f.path),
    ).toEqual(["plan.resources[0].vehicleProfile.grossWeight"]);
  });

  it("reports a malformed value before an unknown key when a plan has both", () => {
    expect(() => parsePlanCreate({ resources: [{ ...res, id: 1, bogus: 2 }] })).toThrow(z.ZodError);
  });
});
