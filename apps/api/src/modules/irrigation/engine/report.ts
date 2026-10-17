// Field report: decision + reason from the water balance. Pure.
import type { DayBalance, Decision, FieldReport } from "@tellia/shared/irrigation";
import type { Phase } from "./cropModel";
import { addDays, daysBetween, round1, round2 } from "./util";
import { type IrrigationInput, runWaterBalance, type WeatherInput } from "./waterBalance";
import { triggerDepletion, type WaterTarget } from "./waterTarget";

/** The field's irrigation system, as the engine needs it. */
export interface ReportSystem {
  /** Share of the pumped water that reaches the roots. */
  efficiency: number;
  /** Smallest gross dose worth a pass, mm. Null or unset = no floor. */
  doseMinMm?: number | null;
  /** Largest gross dose of one pass, mm. Null = no cap. */
  doseMaxMm: number | null;
  /** Days the system needs to come back to a field. Null = no plan_irrigation. */
  roundDays: number | null;
}

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
  /** Cap on one application without a system, mm. Unset = no cap. */
  maxApplicationMm?: number;
  /** Irrigation system of the field. Unset = efficiency 1 and the old cap. */
  system?: ReportSystem | null;
  /** Crop phase on `asOf`; late or mature stops irrigating. */
  phase?: Phase | null;
  /** Depletion at sowing, mm. Defaults to 0 (field capacity), or the dry-start share. */
  startDepletion?: number;
  /** Dry region: the whole profile starts this share empty (see runWaterBalance). */
  dryStart?: { share: number; tawMax: number } | null;
  /** Trigger and refill target of the stage. Unset = trigger at RAW, refill to field capacity. */
  target?: WaterTarget | null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Depletion at or above RAW. The margin hides float noise (0.55 × 100 = 55.000000000000007). */
const reached = (depletion: number, raw: number) => depletion >= raw - 1e-9;

/** The water balance a report reads: same TAW, p, start and efficiency. Scenarios reuse it. */
export function reportBalance(input: ReportInput): DayBalance[] {
  return runWaterBalance({
    days: input.days,
    irrigations: input.irrigations,
    taw: input.taw,
    p: input.p,
    startDepletion: input.startDepletion,
    efficiency: input.system?.efficiency ?? 1,
    dryStart: input.dryStart ?? undefined,
  });
}

export function buildFieldReport(input: ReportInput): FieldReport {
  const { field, season, asOf } = input;
  const system = input.system ?? null;
  const efficiency = system?.efficiency ?? 1;
  const series = reportBalance(input);

  // Morning depletion: end of the last balanced day before asOf (start depletion at sowing).
  const before = series.filter((d) => d.date < asOf);
  const firstTaw = series[0]?.taw ?? input.taw;
  const startMm = input.startDepletion ?? (input.dryStart ? input.dryStart.share * firstTaw : 0);
  const start = Math.min(Math.max(startMm, 0), firstTaw);
  const depletion = before.length ? before[before.length - 1].depletion : start;
  // TAW and RAW of today: roots and p change every day.
  const todayBalance = series.find((d) => d.date === asOf);
  const taw = todayBalance?.taw ?? input.taw;
  const p = todayBalance?.p ?? input.p;
  const raw = todayBalance?.raw ?? p * taw;
  const pct = Math.round((depletion / taw) * 100);
  const depStr = round1(depletion);
  const tawStr = round1(taw);
  const pPct = Math.round(p * 100);

  const today = input.days.find((d) => d.date === asOf);
  const warnings = [...(input.extraWarnings ?? [])];
  const frost = today !== undefined && today.tmin < 0;
  if (frost) warnings.push(`Frost forecast today (min ${round1(today.tmin)} °C).`);

  const rain3 = round1(
    input.days
      .filter((d) => d.date >= asOf && d.date <= addDays(asOf, 2))
      .reduce((s, d) => s + d.rain, 0),
  );

  // Trigger: RAW, or later where the stage tolerates stress (Ks ≥ ksMin). Refill: to the
  // stage's share of TAW, never to field capacity when a target is set (room for rain).
  const ksMin = input.target?.ksMin ?? 1;
  const refillShare = input.target?.refillShare ?? 1;
  const relaxed = ksMin < 1;
  const trigger = triggerDepletion(taw, raw, ksMin);
  const toTarget = (dep: number, tawOf: number) =>
    Math.max(0, Math.round(dep - (1 - refillShare) * tawOf));
  const fillPct = Math.round(refillShare * 100);
  const threshold = relaxed
    ? `the ${Math.round((trigger / taw) * 100)}% threshold allowed before flowering`
    : `the ${pPct}% stress threshold`;

  let decision: Decision;
  let daysUntil: number | null = null;
  let irrigateBy: string | null = null;
  /** Net mm from today's depletion back to the refill target. */
  const need = toTarget(depletion, taw);
  /** Net mm to bring back to the refill target, for the decisions that water. */
  let refill = 0;

  if (!season || !today || today.kc === null) {
    decision = "outside_season";
  } else if (!field.irrigable) {
    decision = "not_irrigable";
  } else if (input.phase === "late" || input.phase === "mature") {
    decision = "crop_maturing";
  } else if (reached(depletion, trigger)) {
    if (frost) {
      decision = "frost_hold";
      refill = need;
      irrigateBy = asOf;
    } else if (rain3 >= need / 2) {
      decision = "wait_for_rain";
    } else {
      decision = "irrigate_today";
      refill = need;
      irrigateBy = asOf;
    }
  } else {
    // First day of the next 7 that ends at or above the next day's trigger: stress starts the
    // morning after. p changes every day, and that morning (like Ks) uses its own RAW.
    const last = addDays(asOf, 6);
    const triggerOf = (d: DayBalance) => triggerDepletion(d.taw, d.raw, ksMin);
    const hit = series.find((d, i) =>
      d.date >= asOf && d.date <= last && reached(d.depletion, triggerOf(series[i + 1] ?? d))
    );
    daysUntil = hit ? daysBetween(asOf, hit.date) + 1 : null;
    const round = system?.roundDays ?? null;
    if (hit && daysUntil !== null && round !== null && daysUntil <= round) {
      decision = "plan_irrigation";
      refill = toTarget(hit.depletion, hit.taw);
      irrigateBy = addDays(asOf, daysUntil);
    } else {
      decision = "no_irrigation";
    }
  }

  // Amounts: net = refill; gross = net ÷ efficiency, kept between the system's smallest and
  // largest pass (net = gross × efficiency after that). Without a system: efficiency 1 and the
  // old cap on one application.
  let irrigateMm = refill;
  let irrigateGrossMm = refill;
  let capped = false;
  let raised = false;
  if (refill > 0 && system) {
    irrigateGrossMm = Math.round(refill / efficiency);
    if (system.doseMaxMm !== null && irrigateGrossMm > system.doseMaxMm) {
      irrigateGrossMm = system.doseMaxMm;
      irrigateMm = round1(irrigateGrossMm * efficiency);
      capped = true;
    } else if (system.doseMinMm != null && irrigateGrossMm < system.doseMinMm) {
      irrigateGrossMm = system.doseMinMm;
      irrigateMm = round1(irrigateGrossMm * efficiency);
      raised = true;
    }
  } else if (refill > 0) {
    const cap = input.maxApplicationMm;
    if (cap !== undefined && refill > cap) {
      irrigateMm = irrigateGrossMm = cap;
      capped = true;
    }
  }
  /** "40 mm (30 mm net)": the gross dose, and the net when some water is lost. */
  const dose = `${irrigateGrossMm} mm` +
    (irrigateMm !== irrigateGrossMm ? ` (${irrigateMm} mm net)` : "");
  const tmin = today ? round1(today.tmin) : 0;
  /** " to bring the reserve back to 80 % (a full refill would be 60 mm)", with a target. */
  const fullMm = system ? Math.round(Math.round(depletion) / efficiency) : Math.round(depletion);
  const fillNote = refillShare < 1
    ? ` to bring the reserve back to ${fillPct} % (a full refill would be ${fullMm} mm)`
    : "";
  const minNote = raised ? ", the smallest pass of the system" : "";
  /** "the 44 mm deficit", or "the 44 mm gap to 80 %" with a target. */
  const gap = (mm: number) => refillShare < 1 ? `${mm} mm gap to ${fillPct} %` : `${mm} mm deficit`;

  let reason: string;
  let headline: string;
  switch (decision) {
    case "outside_season":
      reason = `No crop is growing on ${field.name} on ${asOf}.`;
      headline = `${field.name}: no crop growing, nothing to do.`;
      break;
    case "not_irrigable":
      reason = `Field is not irrigable; root zone is ${pct}% depleted (${depStr} of ${tawStr} mm).`;
      headline = `${field.name}: not irrigable, root zone ${pct}% depleted.`;
      break;
    case "crop_maturing":
      reason =
        `The crop is maturing: stop irrigating, extra water no longer adds yield. Root zone is ${pct}% depleted (${depStr} of ${tawStr} mm).`;
      headline = `${field.name}: the crop is maturing, stop irrigating.`;
      break;
    case "frost_hold":
      if (!system && capped) {
        reason =
          `Frost is forecast today (min ${tmin} °C): irrigate ${irrigateMm} mm once temperatures are above 0 °C, then re-check (deficit ${need} mm).`;
      } else if (capped) {
        reason =
          `Frost is forecast today (min ${tmin} °C): irrigate ${dose} once temperatures are above 0 °C, then more passes (${gap(need)}).`;
      } else {
        reason =
          `Frost is forecast today (min ${tmin} °C): irrigate ${dose} once temperatures are above 0 °C.`;
      }
      headline =
        `${field.name}: frost today, irrigate ${irrigateGrossMm} mm once it is above 0 °C.`;
      break;
    case "wait_for_rain":
      reason =
        `Root zone is ${pct}% depleted, but ${rain3} mm of rain is forecast in the next 3 days, enough to cover most of the ${need} mm need.`;
      headline = `${field.name}: wait, ${rain3} mm of rain is forecast in the next 3 days.`;
      break;
    case "irrigate_today": {
      reason =
        `Root zone is ${pct}% depleted (${depStr} of ${tawStr} mm), above ${threshold}, and only ${rain3} mm of rain is forecast in the next 3 days.`;
      const base = reason.replace(/\.$/, "");
      if (!system && capped) {
        reason = base + `; apply ${irrigateMm} mm today and re-check tomorrow`;
      } else if (capped) {
        reason = base + `; apply ${dose} today, then more passes for the ${gap(need)}.`;
      } else if (system) {
        reason = base + `; apply ${dose} today${minNote}${fillNote}.`;
      }
      headline = `${field.name}: irrigate ${irrigateGrossMm} mm today` +
        (!capped ? "." : system ? ", then more passes." : ", then re-check tomorrow.");
      break;
    }
    case "plan_irrigation":
      reason =
        `Root zone is ${pct}% depleted (${depStr} of ${tawStr} mm) and will pass ${
          relaxed ? threshold : "the stress threshold"
        } in about ${plural(daysUntil!, "day")}: irrigate ${dose} by ${irrigateBy}` +
        (capped ? `, then more passes for the ${gap(refill)}.` : `${minNote}${fillNote}.`);
      headline = `${field.name}: irrigate ${irrigateGrossMm} mm by ${irrigateBy}.`;
      break;
    case "no_irrigation":
      reason = (relaxed && reached(depletion, raw)
        ? `Root zone is ${pct}% depleted (${depStr} of ${tawStr} mm), past the ${pPct}% comfort threshold but below ${threshold}`
        : `Root zone is only ${pct}% depleted (${depStr} of ${tawStr} mm), below ${threshold}`) +
        (daysUntil === null ? "." : `; irrigation expected in about ${daysUntil} days.`);
      headline = daysUntil === null
        ? `${field.name}: no irrigation needed this week.`
        : `${field.name}: no irrigation today, likely needed in about ${plural(daysUntil, "day")}.`;
      break;
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
    triggerMm: round1(trigger),
    targetFillPct: fillPct,
    toTargetMm: refill > 0 ? refill : need,
    depletionPct: pct,
    daysUntilIrrigation: daysUntil,
    rainNext3DaysMm: rain3,
    reason,
    warnings,
    irrigateGrossMm,
    irrigateBy,
    headline,
  };
}

const ORDER: Decision[] = [
  "irrigate_today",
  "frost_hold",
  "plan_irrigation",
  "wait_for_rain",
  "no_irrigation",
  "crop_maturing",
  "not_irrigable",
  "outside_season",
];

/** Most urgent first: by decision, then by depletion % descending. */
export function rankReports(reports: FieldReport[]): FieldReport[] {
  return [...reports].sort((a, b) =>
    ORDER.indexOf(a.decision) - ORDER.indexOf(b.decision) || b.depletionPct - a.depletionPct
  );
}
