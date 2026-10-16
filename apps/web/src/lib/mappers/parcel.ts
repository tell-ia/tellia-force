import type { FieldReport, ParcelReport, Reserve } from "@tellia/shared";

// Pure domain→view mappers + the small computations the screens need. Tested in
// parcel.test.ts on the demo numbers. No rendering, no side effects.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

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

/**
 * Lightweight live ParcelReport from the engine's FieldReport (reco + reserve +
 * reason). The rich sections (series/soil/season/stage) are left out until the
 * full get_parcel_report endpoint is available.
 */
export function fieldReportToParcelReport(
  r: FieldReport,
  opts: { farmId: number; areaHa?: number },
): ParcelReport {
  return {
    schemaVersion: "v0",
    id: r.fieldId,
    farmId: opts.farmId,
    name: r.fieldName,
    cropName: r.cropName ?? "—",
    areaHa: opts.areaHa ?? 0,
    asOf: r.asOf,
    recommendation: {
      decision: r.decision,
      headline: headlineFor(r),
      netMm: r.irrigateMm,
      grossMm: grossFromNet(r.irrigateMm),
      efficiency: 0.8,
      reason: r.reason,
      secondPass: null,
    },
    reserve: fieldReportToReserve(r),
    method: "FAO-56 water balance (live summary). Full history & soil come from get_parcel_report.",
  };
}
