import { FieldReportSchema } from "@tellia/shared";
import { http } from "./core";

// The field report only returns a ~16-day window around its `date`. To draw a
// season-long soil-water heatmap for the date picker, we stitch several reports at
// asOf points stepping back through the season and merge their daily balances.
// Each day's % uses that day's own TAW (capacity grows with the roots).

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
  byKey: Record<string, HeatDay>; // keyed "MM-DD"
  year: number;
  minDate: string; // earliest day we have
  maxDate: string; // latest day we have
}

const OFFSETS = [0, -15, -30, -45, -60, -75]; // asOf points back through the season

export async function getSeasonHeatmap(fieldId: number, today: string): Promise<SeasonHeatmap | null> {
  const dates = OFFSETS.map((o) => addDays(today, o));
  const reports = await Promise.all(
    dates.map((d) =>
      http.get(`/irrigation/fields/${fieldId}/report?date=${d}`, FieldReportSchema).catch(() => null),
    ),
  );

  const byKey: Record<string, HeatDay> = {};
  let year = Number(today.slice(0, 4));
  let minDate = today;
  let maxDate = today;
  let got = false;

  for (const r of reports) {
    if (!r?.series?.length) continue;
    for (const d of r.series) {
      if (d.taw <= 0) continue;
      const key = d.date.slice(5);
      const forecast = d.date > r.asOf;
      const reserveMm = Math.max(0, d.taw - d.depletion);
      const val: HeatDay = {
        pct: Math.max(0, Math.min(100, Math.round((reserveMm / d.taw) * 100))),
        rain: Math.round(d.rain),
        irr: Math.round(d.irrigation),
        forecast,
        reserveMm: Math.round(reserveMm),
        capMm: Math.round(d.taw),
      };
      const prev = byKey[key];
      // Prefer an actual (past) reading over a forecast one for the same day.
      if (!prev || (prev.forecast && !forecast)) byKey[key] = val;
      got = true;
      year = Number(d.date.slice(0, 4));
      if (d.date < minDate) minDate = d.date;
      if (d.date > maxDate) maxDate = d.date;
    }
  }

  if (!got) return null;
  return { byKey, year, minDate, maxDate };
}
