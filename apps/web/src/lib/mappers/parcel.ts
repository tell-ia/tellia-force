import type { BalancePoint, DayBalance, FieldReport, ParcelReport, Reserve } from "@tellia/shared";

// Pure domain→view mappers + the small computations the screens need. Tested in
// parcel.test.ts on the demo numbers. No rendering, no side effects.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// No front translation: the DB already holds every language (crop_ref.name_en/fr/
// es/it…). The backend serves crop/stage names in the right language; we just
// render what the report returns. `cropName` falls back to a dash only if null.
export const cropLabel = (_code: string | null | undefined, name: string | null | undefined): string =>
  name || "—";

/** Gross dose at the gun from the net dose (reel gun ≈ 0.8 efficiency). */
export const grossFromNet = (netMm: number, efficiency = 0.8): number =>
  Math.round(netMm / efficiency);

/** Reserve as an integer % of capacity (usable reserve). */
export const reservePct = (availableMm: number, capacityMm: number): number =>
  Math.round((availableMm / capacityMm) * 100);

/** "Fri eve" style label for the day the comfort threshold is reached.
 *  Parsed as UTC so the weekday never shifts with the viewer's timezone. */
export function eveLabel(asOf: string, daysUntil: number | null): string {
  if (daysUntil == null) return "this week";
  const p = asOf.split("-").map(Number);
  const base = Date.UTC(p[0] ?? 0, (p[1] ?? 1) - 1, p[2] ?? 1);
  const day = new Date(base + daysUntil * 86_400_000).getUTCDay();
  return `${WEEKDAYS[day]} eve`;
}

/**
 * Reserve % with X mm applied. The prototype's model is a flat add of
 * net/capacity points on top of the no-water reserve (capped at 100).
 */
export const wateredPct = (noWaterPct: number, netMm: number, capacityMm: number): number =>
  Math.min(100, Math.round(noWaterPct + (netMm / capacityMm) * 100));

/**
 * Engine FieldReport → ReserveGauge props. This is what the fast advisor
 * endpoint gives; the full `get_parcel_report` carries the same reserve block.
 */
export function fieldReportToReserve(r: FieldReport): Reserve {
  const capacityMm = Math.round(r.tawMm);
  const availableMm = Math.round(r.tawMm - r.depletionMm);
  const thresholdMm = Math.round(r.tawMm - r.rawMm);
  return {
    availableMm,
    capacityMm,
    pct: 100 - r.depletionPct,
    thresholdMm,
    thresholdPct: reservePct(thresholdMm, capacityMm),
    thresholdLabel: eveLabel(r.asOf, r.daysUntilIrrigation),
    usedByThresholdMm: Math.max(0, availableMm - thresholdMm),
  };
}

function headlineFor(r: FieldReport): string {
  switch (r.decision) {
    case "irrigate_today":
      return "Irrigate now";
    case "wait_for_rain":
      return "Wait for rain";
    case "frost_hold":
      return "Hold · frost";
    case "plan_irrigation":
      return "Irrigate soon";
    case "crop_maturing":
      return "Maturing · stop";
    case "no_irrigation":
      return "No water needed";
    case "not_irrigable":
      return "Rain-fed";
    case "outside_season":
      return "Off season";
    default:
      return "";
  }
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const dayOfMonth = (iso: string): string => String(Number(iso.split("-")[2] ?? 0));

/** Engine DayBalance → chart BalancePoint. reserve = TAW − depletion. */
function toBalancePoint(d: DayBalance, asOf: string): BalancePoint {
  return {
    date: d.date,
    dayLabel: dayOfMonth(d.date),
    rain: round1(d.rain),
    irrigation: round1(d.irrigation),
    cropUse: round1(d.etc),
    reserveMm: round1(d.taw - d.depletion),
    forecast: d.date > asOf,
  };
}

/**
 * Engine FieldReport → ParcelReport. The v2 report carries the detail (series,
 * season, soil, stage) so this is a full live report: recommendation + reserve +
 * water-balance series + season totals. Sections the report omits stay undefined
 * and the UI hides them.
 */
export function fieldReportToParcelReport(
  r: FieldReport,
  opts: { farmId: number; areaHa?: number },
): ParcelReport {
  const efficiency =
    r.irrigateMm > 0 && r.irrigateGrossMm > 0
      ? Math.round((r.irrigateMm / r.irrigateGrossMm) * 100) / 100
      : 0.8;

  const report: ParcelReport = {
    schemaVersion: "v0",
    id: r.fieldId,
    farmId: opts.farmId,
    name: r.fieldName,
    cropName: cropLabel(r.cropCode, r.cropName),
    areaHa: opts.areaHa ?? 0,
    asOf: r.asOf,
    recommendation: {
      decision: r.decision,
      headline: r.headline || headlineFor(r),
      netMm: r.irrigateMm,
      grossMm: r.irrigateGrossMm,
      efficiency,
      reason: r.reason,
      secondPass: null,
    },
    reserve: fieldReportToReserve(r),
    method: "FAO-56 soil water balance (live). Weather from AgERA5; stages from degree-days.",
  };

  if (r.series?.length) report.series = r.series.map((d) => toBalancePoint(d, r.asOf));
  if (r.season) {
    report.seasonBalance = {
      rainMm: round1(r.season.rainMm),
      irrigatedMm: round1(r.season.irrigationNetMm),
      cropUseMm: round1(r.season.etcMm),
      drainedMm: round1(r.season.drainageMm),
      stressDays: r.season.stressDays,
      cropDays: r.season.daysSinceSowing,
    };
  }
  return report;
}
