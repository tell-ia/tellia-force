import type { BalancePoint, CropPhase, DayBalance, FieldReport, ParcelReport, RefillPlanSeries, Reserve } from "@tellia/shared";

/** A soil_analysis row's texture + OM, joined by field in the api layer. */
export interface SoilSample {
  sand_pct: number | null;
  silt_pct: number | null;
  clay_pct: number | null;
  organic_matter_pct: number | null;
}

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

/** Part of the day's reserve % that is that day's rain; the rest was already in the soil. */
export const rainPct = (rainMm: number, tawMm: number, noWaterPct: number): number =>
  Math.max(0, Math.min(noWaterPct, Math.round((rainMm / tawMm) * 100)));

/**
 * When the deficit is larger than one pass, the field is refilled over several
 * passes (the reel gun caps each pass). Returns the plan, or null for a single pass.
 */
export function refillPlan(deficitMm: number, netMm: number): { morePasses: number; note: string } | null {
  if (netMm <= 0 || deficitMm <= netMm) return null;
  const morePasses = Math.ceil(deficitMm / netMm) - 1;
  if (morePasses < 1) return null;
  return {
    morePasses,
    note: `then ~${morePasses} more pass${morePasses > 1 ? "es" : ""} to refill (${Math.round(deficitMm)} mm deficit)`,
  };
}

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
export function toBalancePoint(d: DayBalance, asOf: string): BalancePoint {
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

const PHASES: readonly CropPhase[] = ["ini", "dev", "mid", "late", "mature"];
const PHASE_LABEL: Record<CropPhase, string> = {
  ini: "Emergence",
  dev: "Growth",
  mid: "Flowering",
  late: "Grain fill",
  mature: "Mature",
};
const phaseSteps = (cur: CropPhase) =>
  PHASES.map((p) => ({ label: PHASE_LABEL[p], weight: 1, current: p === cur }));
const phaseProgress = (cur: CropPhase) => (PHASES.indexOf(cur) + 0.5) / PHASES.length;

function weekday(iso: string): string {
  const p = iso.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(p[0] ?? 0, (p[1] ?? 1) - 1, p[2] ?? 1)).getUTCDay()] ?? "";
}

function stageNote(stage: { sensitive: boolean; floweringDate: string | null }): string {
  const parts: string[] = [];
  if (stage.floweringDate) parts.push(`Flowering reached ${stage.floweringDate}.`);
  parts.push(
    stage.sensitive
      ? "Yield-sensitive window — avoid water stress."
      : "Outside the most sensitive window.",
  );
  return parts.join(" ");
}

/**
 * Engine FieldReport → ParcelReport. The v2 report carries the detail (series,
 * season, soil, stage); joined with a soil sample + crop base temperature it is a
 * full live report. Sections without data stay undefined and the UI hides them.
 */
export function fieldReportToParcelReport(
  r: FieldReport,
  opts: { farmId: number; areaHa?: number; gddBase?: number; soil?: SoilSample | null; plan?: RefillPlanSeries | null },
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
      headline: headlineFor(r), // short pill; the engine's full sentence is in `reason`
      netMm: r.irrigateMm,
      grossMm: r.irrigateGrossMm,
      efficiency,
      reason: r.reason,
      secondPass: refillPlan(r.depletionMm, r.irrigateMm)?.note ?? null,
    },
    reserve: fieldReportToReserve(r),
    method: "FAO-56 soil water balance (live). Weather from AgERA5; stages from degree-days.",
  };

  if (r.series?.length) report.series = r.series.map((d) => toBalancePoint(d, r.asOf));
  if (opts.plan) report.plan = opts.plan;

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

  if (r.stage) {
    const todayEtc = r.series?.find((d) => d.date === r.asOf)?.etc;
    const tomorrowEtc = r.series?.find((d) => d.date > r.asOf)?.etc;
    report.cropStage = {
      label: r.stageLabel ?? PHASE_LABEL[r.stage.phase],
      daysSinceSowing: r.season?.daysSinceSowing ?? 0,
      gdd: Math.round(r.stage.gddSinceSowing),
      gddBase: opts.gddBase ?? 0,
      useTodayMm: round1(todayEtc ?? 0),
      useTomorrowMm: round1(tomorrowEtc ?? 0),
      note: stageNote(r.stage),
      progress: phaseProgress(r.stage.phase),
      steps: phaseSteps(r.stage.phase),
    };
  }

  const s = opts.soil;
  if (s && s.sand_pct != null) {
    const sandPct = Math.round(s.sand_pct);
    const clayPct = Math.round(s.clay_pct ?? 0);
    const siltPct = Math.round(s.silt_pct ?? Math.max(0, 100 - sandPct - clayPct));
    const usableMm = Math.round(r.soil?.tawMm ?? r.tawMm);
    report.soil = {
      texture: r.soil?.textureClass ?? "—",
      sandPct,
      siltPct,
      clayPct,
      omPct: round1(s.organic_matter_pct ?? 0),
      usableMm,
      rootDepthM: r.rootDepthM ?? 0,
      note: `${usableMm} mm usable${r.rootDepthM ? ` over ${r.rootDepthM} m of roots` : ""}.`,
    };
  }

  const forecast = (r.series ?? []).filter((d) => d.date > r.asOf).slice(0, 5);
  if (forecast.length) {
    const cap = report.reserve.capacityMm;
    // "+ watered" follows the real plan (reserve climbing back) when we have one.
    const planRes = opts.plan ? new Map(opts.plan.series.map((p) => [p.date, p.reserveMm])) : null;
    report.nextDays = forecast.map((d) => {
      const pctNoWater = Math.round(((d.taw - d.depletion) / d.taw) * 100);
      const planMm = planRes?.get(d.date);
      const pctWatered =
        planMm != null ? Math.round((planMm / d.taw) * 100) : wateredPct(pctNoWater, r.irrigateMm, cap);
      const pctRain = rainPct(d.rain, d.taw, pctNoWater);
      return { day: `${weekday(d.date)} ${dayOfMonth(d.date)}`, pctNoWater, pctRain, rainMm: round1(d.rain), pctWatered };
    });
  }

  return report;
}
