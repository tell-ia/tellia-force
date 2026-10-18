import type { BalancePoint, CropPhase, DayBalance, FieldReport, IrrigationRecord, ParcelReport, Recommendation, RefillPlanSeries, Reserve } from "@tellia/shared";

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

/** The crop growing today and its stage, e.g. "Maïs grain · Flowering"; says so when none grows. */
export const cropLine = (cropName: string, stageLabel: string | null | undefined): string =>
  cropName === "—" || !cropName ? "No crop growing" : stageLabel ? `${cropName} · ${stageLabel}` : cropName;

/** The Log screen's dose at the gun: the one set with the stepper, else the advised gross dose
 *  (35 mm when nothing is advised). Untouched, it follows the advice when the report reloads. */
export const formDose = (edited: number | null, advisedGross: number): number =>
  edited ?? (advisedGross || 35);

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
 * Gross mm logged on `date` (confirmed and planned waterings, like the engine counts), or
 * null when nothing was logged that day. The advice already counts it; the card says so.
 */
export function wateredOnMm(records: readonly IrrigationRecord[], date: string): number | null {
  const day = records.filter((r) => r.date === date && r.status !== "draft");
  return day.length ? day.reduce((s, r) => s + r.mm, 0) : null;
}

/** What the hero card says, given the gross mm logged today (null = none; the advice counts it). */
export type HeroDose =
  | { mode: "plain"; headline: string; label: string; mm: number }
  | { mode: "done"; headline: string; label: string; mm: number; reachedMm: number }
  | { mode: "topUp"; headline: string; label: string; mm: number; appliedMm: number; reachedMm: number };

/**
 * Watered today and nothing more needed: the card shows what went on, not "Apply 0 mm". Watered
 * today and still short: the dose is a top-up on top of it ("Irrigate now" → "Top up now"; a
 * later date stays as it is).
 */
export function heroDose(rec: Recommendation, wateredTodayMm: number | null): HeroDose {
  if (wateredTodayMm == null) return { mode: "plain", headline: rec.headline, label: "Apply", mm: rec.grossMm };
  const reachedMm = Math.round(wateredTodayMm * (rec.efficiency || 1));
  if (rec.grossMm === 0) return { mode: "done", headline: "Watered today", label: "Applied today", mm: wateredTodayMm, reachedMm };
  return {
    mode: "topUp",
    headline: rec.decision === "irrigate_today" ? "Top up now" : rec.headline,
    label: "Apply another",
    mm: rec.grossMm,
    appliedMm: wateredTodayMm,
    reachedMm,
  };
}

/** Part of the day's reserve % that is that day's rain; the rest was already in the soil. */
export const rainPct = (rainMm: number, tawMm: number, noWaterPct: number): number =>
  Math.max(0, Math.min(noWaterPct, Math.round((rainMm / tawMm) * 100)));

/**
 * When the gap is larger than one pass, the field is refilled over several passes (the reel
 * gun caps each pass). A leftover under half a pass is left to the next check, not announced.
 * Returns the plan, or null for a single pass. With `fillPct` the gap is to that target.
 */
export function refillPlan(
  deficitMm: number,
  netMm: number,
  fillPct?: number,
): { morePasses: number; note: string } | null {
  if (netMm <= 0 || deficitMm <= netMm) return null;
  const morePasses = Math.round((deficitMm - netMm) / netMm);
  if (morePasses < 1) return null;
  const passes = `~${morePasses} more pass${morePasses > 1 ? "es" : ""}`;
  const gap = Math.round(deficitMm);
  return {
    morePasses,
    note: fillPct !== undefined && fillPct < 100
      ? `then ${passes} to reach ${fillPct} % (${gap} mm to go)`
      : `then ${passes} to refill (${gap} mm deficit)`,
  };
}

/** "then ~2 more passes…" note, counted to the engine's refill target (old reports: to full). */
export const refillPassesNote = (
  r: Pick<FieldReport, "depletionMm" | "irrigateMm" | "toTargetMm" | "targetFillPct">,
): string | null =>
  (r.toTargetMm === undefined
    ? refillPlan(r.depletionMm, r.irrigateMm)
    : refillPlan(r.toTargetMm, r.irrigateMm, r.targetFillPct))?.note ?? null;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Irrigate by Fri 17 Jul" from the engine's last day to water (UTC, like eveLabel). */
export function irrigateByLabel(asOf: string, by: string | null): string {
  if (!by) return "Irrigate soon";
  const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  const days = Math.round((utc(by) - utc(asOf)) / 86_400_000);
  if (days <= 0) return "Irrigate today";
  if (days === 1) return "Irrigate tomorrow";
  const d = new Date(utc(by));
  return `Irrigate by ${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * Engine FieldReport → ReserveGauge props. This is what the fast advisor
 * endpoint gives; the full `get_parcel_report` carries the same reserve block.
 */
export function fieldReportToReserve(r: FieldReport): Reserve {
  const capacityMm = Math.round(r.tawMm);
  const availableMm = Math.round(r.tawMm - r.depletionMm);
  // The engine's trigger: RAW, or later before flowering. Older reports only have RAW.
  const thresholdMm = Math.round(r.tawMm - (r.triggerMm ?? r.rawMm));
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
      return irrigateByLabel(r.asOf, r.irrigateBy);
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
      secondPass: refillPassesNote(r),
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
      steps: r.stage.phases?.length
        ? r.stage.phases.map((ph) => ({
            label: PHASE_LABEL[ph.phase],
            weight: 1,
            current: ph.phase === r.stage!.phase,
            startDate: ph.startDate,
            forecast: ph.forecast,
          }))
        : phaseSteps(r.stage.phase),
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
    const planDay = opts.plan ? new Map(opts.plan.series.map((p) => [p.date, p])) : null;
    const planPass = opts.plan ? new Map(opts.plan.passes.map((p) => [p.date, p.grossMm])) : null;
    report.nextDays = forecast.map((d) => {
      const pctNoWater = Math.round(((d.taw - d.depletion) / d.taw) * 100);
      const plan = planDay?.get(d.date);
      const pctWatered =
        plan ? Math.round((plan.reserveMm / d.taw) * 100) : wateredPct(pctNoWater, r.irrigateMm, cap);
      const pctRain = rainPct(d.rain, d.taw, pctNoWater);
      // That day's own watering (net, % of the reserve) and the gross mm pumped, for the plan tanks.
      const pctIrrigation = plan ? Math.round((plan.irrigation / d.taw) * 100) : 0;
      const waterMm = planPass?.get(d.date);
      return {
        day: `${weekday(d.date)} ${dayOfMonth(d.date)}`, pctNoWater, pctRain, rainMm: round1(d.rain), pctWatered,
        pctIrrigation, ...(waterMm ? { waterMm } : {}),
      };
    });
  }

  return report;
}
