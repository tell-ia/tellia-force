// Field report: decision + reason from the water balance. Pure.
import type { DayBalance, Decision, FieldReport } from "@tellia/shared/irrigation";
import { addDays, round1, round2 } from "./util";
import { type IrrigationInput, runWaterBalance, type WeatherInput } from "./waterBalance";

export interface ReportInput {
  field: { id: number; name: string; irrigable: boolean };
  /** Crop season growing on `asOf`, or null. */
  season: { cropCode: string } | null;
  cropName: string | null;
  days: WeatherInput[];
  irrigations: IrrigationInput[];
  taw: number;
  p: number;
  asOf: string;
  stageLabel: string | null;
  extraWarnings?: string[];
}

export function buildFieldReport(input: ReportInput): FieldReport {
  const { field, season, taw, p, asOf } = input;
  const raw = p * taw;
  const series: DayBalance[] = runWaterBalance({
    days: input.days,
    irrigations: input.irrigations,
    taw,
    p,
  });

  // Morning depletion: end of the last balanced day before asOf (0 at season start).
  const before = series.filter((d) => d.date < asOf);
  const depletion = before.length ? before[before.length - 1].depletion : 0;
  const pct = Math.round((depletion / taw) * 100);
  const depStr = round1(depletion);
  const tawStr = round1(taw);
  const pPct = Math.round(p * 100);

  const today = input.days.find((d) => d.date === asOf);
  const warnings = [...(input.extraWarnings ?? [])];
  const frost = today !== undefined && today.tmin < 0;
  if (frost) warnings.push(`Frost forecast today (min ${today.tmin} °C).`);

  const rain3 = round1(
    input.days
      .filter((d) => d.date >= asOf && d.date <= addDays(asOf, 2))
      .reduce((s, d) => s + d.rain, 0),
  );

  let decision: Decision;
  let irrigateMm = 0;
  let daysUntil: number | null = null;
  let reason: string;
  const need = Math.round(depletion);

  if (!season || !today || today.kc === null) {
    decision = "outside_season";
    reason = `No crop is growing on ${field.name} on ${asOf}.`;
  } else if (!field.irrigable) {
    decision = "not_irrigable";
    reason = `Field is not irrigable; root zone is ${pct}% depleted (${depStr} of ${tawStr} mm).`;
  } else if (depletion >= raw) {
    if (frost) {
      decision = "frost_hold";
      irrigateMm = need;
      reason =
        `Frost is forecast today (min ${today.tmin} °C): irrigate ${need} mm once temperatures are above 0 °C.`;
    } else if (rain3 >= need / 2) {
      decision = "wait_for_rain";
      reason =
        `Root zone is ${pct}% depleted, but ${rain3} mm of rain is forecast in the next 3 days, enough to cover most of the ${need} mm need.`;
    } else {
      decision = "irrigate_today";
      irrigateMm = need;
      reason =
        `Root zone is ${pct}% depleted (${depStr} of ${tawStr} mm), above the ${pPct}% stress threshold, and only ${rain3} mm of rain is forecast in the next 3 days.`;
    }
  } else {
    decision = "no_irrigation";
    const last = addDays(asOf, 6);
    const idx = series.filter((d) => d.date >= asOf && d.date <= last)
      .findIndex((d) => d.depletion >= raw);
    daysUntil = idx === -1 ? null : idx + 1;
    reason =
      `Root zone is only ${pct}% depleted (${depStr} of ${tawStr} mm), below the ${pPct}% stress threshold` +
      (daysUntil === null ? "." : `; irrigation expected in about ${daysUntil} days.`);
  }

  return {
    fieldId: field.id,
    fieldName: field.name,
    irrigable: field.irrigable,
    cropCode: season?.cropCode ?? null,
    cropName: season ? input.cropName : null,
    asOf,
    stageLabel: season ? input.stageLabel : null,
    kc: today?.kc != null ? round2(today.kc) : null,
    decision,
    irrigateMm,
    depletionMm: depStr,
    tawMm: tawStr,
    rawMm: round1(raw),
    depletionPct: pct,
    daysUntilIrrigation: daysUntil,
    rainNext3DaysMm: rain3,
    reason,
    warnings,
  };
}

const ORDER: Decision[] = [
  "irrigate_today",
  "frost_hold",
  "wait_for_rain",
  "no_irrigation",
  "not_irrigable",
  "outside_season",
];

/** Most urgent first: by decision, then by depletion % descending. */
export function rankReports(reports: FieldReport[]): FieldReport[] {
  return [...reports].sort((a, b) =>
    ORDER.indexOf(a.decision) - ORDER.indexOf(b.decision) || b.depletionPct - a.depletionPct
  );
}
