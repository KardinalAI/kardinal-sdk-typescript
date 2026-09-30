/**
 * ISO 8601 duration parsing, written from scratch against the `Duration`
 * pattern in openapi.yaml (`^P(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(\d+H)?(\d+M)?(\d+S)?)?$`).
 */

const PATTERN =
  /^P(?:(?<years>\d+)Y)?(?:(?<months>\d+)M)?(?:(?<weeks>\d+)W)?(?:(?<days>\d+)D)?(?:T(?:(?<hours>\d+)H)?(?:(?<minutes>\d+)M)?(?:(?<seconds>\d+)S)?)?$/;

const DAYS_PER_YEAR = 365;
const DAYS_PER_MONTH = 30;

/**
 * Parse an ISO 8601 duration string (e.g. `PT5M`, `P1DT2H`) into
 * milliseconds. `Y`/`M` (calendar year/month) are approximated as 365/30
 * days, since there's no calendar concept here. `maxOptimizationDuration`
 * and the other `Duration` fields in this API are always specified in
 * `D`/`T` units in practice, so the approximation is not expected to matter.
 */
export function parseDurationMs(value: string): number {
  const match = PATTERN.exec(value);
  if (!match || value === "P" || value === "PT") {
    throw new Error(`Not a valid ISO 8601 duration: ${JSON.stringify(value)}`);
  }
  const g = match.groups ?? {};
  const num = (key: string) => (g[key] ? parseInt(g[key], 10) : 0);
  const days = num("years") * DAYS_PER_YEAR + num("months") * DAYS_PER_MONTH + num("weeks") * 7 + num("days");
  const ms =
    days * 86_400_000 + num("hours") * 3_600_000 + num("minutes") * 60_000 + num("seconds") * 1_000;
  return ms;
}
