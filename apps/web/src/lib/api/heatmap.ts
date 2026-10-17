import { FieldReportSchema, type FieldReport } from "@tellia/shared";
import { http } from "./core";

// The field report only returns a ~16-day window around its `date`. To draw a
// soil-water heatmap for the date picker, we stitch several reports at asOf
// points stepping back from an anchor day and merge their daily balances.
// Each day's % uses that day's own TAW (capacity grows with the roots).
// Days are keyed by their full date: "MM-DD" alone mixed two years around New Year.

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface HeatDay {
  pct: number;
  rain: number;
  irr: number;
  forecast: boolean;
  reserveMm: number;
  capMm: number;
}
export interface SeasonHeatmap {
  byDate: Record<string, HeatDay>; // keyed "YYYY-MM-DD"
}

/** asOf points back from the anchor: together they cover ~85 days before it and 5 after. */
const OFFSETS = [0, -15, -30, -45, -60, -75];

/** Adds days to a map; for the same day an actual (past) reading beats a forecast one. */
export function mergeHeatDays(into: Record<string, HeatDay>, add: Record<string, HeatDay>): Record<string, HeatDay> {
  const out = { ...into };
  for (const [date, day] of Object.entries(add)) {
    const prev = out[date];
    if (!prev || (prev.forecast && !day.forecast)) out[date] = day;
  }
  return out;
}

/** Merges report series into one map, with the same actual-beats-forecast rule. */
export function stitchReports(reports: (Pick<FieldReport, "asOf" | "series"> | null)[]): Record<string, HeatDay> {
  let byDate: Record<string, HeatDay> = {};
  for (const r of reports) {
    const days: Record<string, HeatDay> = {};
    for (const d of r?.series ?? []) {
      if (d.taw <= 0) continue;
      const reserveMm = Math.max(0, d.taw - d.depletion);
      days[d.date] = {
        pct: Math.max(0, Math.min(100, Math.round((reserveMm / d.taw) * 100))),
        rain: Math.round(d.rain),
        irr: Math.round(d.irrigation),
        forecast: d.date > r!.asOf,
        reserveMm: Math.round(reserveMm),
        capMm: Math.round(d.taw),
      };
    }
    byDate = mergeHeatDays(byDate, days);
  }
  return byDate;
}

/**
 * Soil water per day for the ~85 days up to `anchor` (+5 forecast days). The API refuses an
 * asOf more than 7 days after the project's today, so the caller keeps `anchor` ≤ today.
 * A failed or out-of-season report just leaves its days empty.
 */
export async function getSeasonHeatmap(fieldId: number, anchor: string): Promise<SeasonHeatmap> {
  const reports = await Promise.all(
    OFFSETS.map((o) =>
      http.get(`/irrigation/fields/${fieldId}/report?date=${addDays(anchor, o)}`, FieldReportSchema).catch(() => null),
    ),
  );
  return { byDate: stitchReports(reports) };
}
