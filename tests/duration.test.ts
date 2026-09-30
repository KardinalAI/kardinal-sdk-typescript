import { describe, expect, it } from "vitest";
import { parseDurationMs } from "../src/core/duration.js";

describe("parseDurationMs", () => {
  it.each([
    ["PT5M", 300_000],
    ["P1DT2H", 93_600_000],
    ["P1Y", 365 * 86_400_000],
    ["P1M", 30 * 86_400_000],
    ["P1W", 7 * 86_400_000],
    ["PT10S", 10_000],
  ])("parses %s", (value, expected) => {
    expect(parseDurationMs(value)).toBe(expected);
  });

  it.each(["P", "PT", "garbage", "", "1D", "PT5X"])("rejects %j", (value) => {
    expect(() => parseDurationMs(value)).toThrow();
  });
});
