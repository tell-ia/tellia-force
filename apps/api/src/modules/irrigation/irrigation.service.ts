// Irrigation use cases shared by the REST module and the Mastra tools/workflows.
// Everything numeric comes from the engine; this layer only orchestrates data,
// weather and validation.

import { HTTPException } from "hono/http-exception";
import {
  type DayBalance,
  type FarmAdvice,
  type FieldReport,
  type IrrigationRecord,
  IsoDateSchema,
  type ScenarioEvent,
  type ScenarioResult,
  type WeatherDay,
} from "@tellia/shared/irrigation";
import type { CorrectionAction, IrrigationAmount } from "@tellia/shared/farm";
import {
  cropNameIn,
  type CropRef,
  type CropSeason,
  type CropStage,
  type FarmData,
  type Field,
  type IrrigationOperation,
  type IrrigationSystem,
  type OperationSource,
  type OperationStatus,
} from "./data/farmData";
import { cropWaterParams, kcAtFraction, kcFromRef, seasonFraction } from "./engine/crop";
import {
  type CropDay,
  cropDay,
  type CropParams,
  type CropPhases,
  dailyGdd,
  type Phase,
} from "./engine/cropModel";
import { buildFieldReport, rankReports, reportBalance, type ReportInput } from "./engine/report";
import { createFarmInfoService, type FarmInfoService } from "./farmInfo.service";
import { createProductCheckService, type ProductCheckService } from "./productCheck.service";
import { createFarmLookupService, type FarmLookupService } from "./farmLookup.service";
import { applyScenario, compareReports } from "./engine/scenario";
import {
  DEFAULT_LOAM,
  type SoilWater,
  soilWaterFromClass,
  soilWaterFromTexture,
  totalAvailableWater,
  usdaTextureClass,
} from "./engine/soil";
import { addDays, daysBetween, round1, round2 } from "./engine/util";
import type { IrrigationInput, WeatherInput } from "./engine/waterBalance";
import { kyStageOf, type WaterTarget, waterTarget } from "./engine/waterTarget";
import type { WeatherService } from "./weather/weatherService";

export interface FieldMatch {
  fieldId: number;
  name: string;
  cropName: string | null;
}

export interface IrrigationDraftInput {
  fieldId: number;
  date: string;
  mm: number;
  memberId: number | null;
}

export interface IrrigationPreview {
  fieldId: number;
  fieldName: string;
  date: string;
  mm: number;
  summary: string;
}

/** A correction of a confirmed irrigation. For an update, a missing date or mm keeps the old one. */
export interface IrrigationCorrectionInput {
  operationId: number;
  action: CorrectionAction;
  date?: string;
  mm?: number;
}

export interface IrrigationCorrectionPreview {
  operationId: number;
  fieldId: number;
  fieldName: string;
  action: CorrectionAction;
  before: IrrigationAmount;
  /** Null for a delete. */
  after: IrrigationAmount | null;
  summary: string;
}

/**
 * Irrigation use cases, plus field details and the journal (farmInfo.service.ts), the
 * product check (productCheck.service.ts) and the farm data lookup (farmLookup.service.ts).
 */
export interface IrrigationService extends FarmInfoService, ProductCheckService, FarmLookupService {
  today(): string;
  /** Main contact's member id, or null when the farm has none. */
  defaultMemberId(): Promise<number | null>;
  resolveField(query: string): Promise<FieldMatch[]>;
  /**
   * One field's report. `full` (default true) adds the season totals and the series; the
   * farm advice leaves them out.
   */
  getFieldReport(
    fieldId: number,
    asOf?: string,
    opts?: { full?: boolean },
  ): Promise<FieldReport>;
  getFarmAdvice(asOf?: string): Promise<FarmAdvice>;
  simulateScenario(
    fieldId: number,
    events: ScenarioEvent[],
    asOf?: string,
  ): Promise<ScenarioResult>;
  getWeather(fieldId: number, asOf?: string): Promise<WeatherDay[]>;
  previewIrrigation(input: { fieldId: number; date: string; mm: number }): Promise<
    IrrigationPreview
  >;
  createDraftIrrigation(input: IrrigationDraftInput): Promise<IrrigationRecord>;
  confirmIrrigation(operationId: number): Promise<IrrigationRecord>;
  cancelIrrigation(operationId: number): Promise<void>;
  recordIrrigation(
    input: IrrigationDraftInput & { source: OperationSource },
  ): Promise<IrrigationRecord>;
  listIrrigations(
    fieldId: number,
    range?: { from?: string; to?: string },
  ): Promise<IrrigationRecord[]>;
  /**
   * Checks a correction and says it in one question; changes nothing. The operation must be a
   * confirmed irrigation of this farm; new values pass the same checks as a new record.
   */
  previewIrrigationCorrection(input: IrrigationCorrectionInput): Promise<
    IrrigationCorrectionPreview
  >;
  /** Applies an update after the same checks as the preview. Returns the updated record. */
  updateIrrigation(
    operationId: number,
    change: { date?: string; mm?: number },
  ): Promise<IrrigationRecord>;
  /** Deletes a confirmed irrigation of this farm. Returns the record as it was. */
  deleteIrrigation(operationId: number): Promise<IrrigationRecord>;
}

const normalize = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Articles say nothing about which field: "Le Puy" must not match every "Le ..." field. */
const ARTICLES = new Set(["les", "des", "the", "los", "las", "del"]);
const words = (s: string) =>
  normalize(s).split(" ").filter((w) => w.length > 2 && !ARTICLES.has(w));

/**
 * How a word sounds, roughly, in French: speech-to-text spells field names by ear
 * ("Le Puits" comes back as "Le Puy", "La Vallée" as "the valley"). Silent endings go,
 * y is i, eau/au is o, ai/ei is e, double letters are one.
 */
const sound = (w: string) =>
  w.replace(/ph/g, "f").replace(/qu|ck|c(?=[aou])/g, "k").replace(/y/g, "i")
    .replace(/e?au/g, "o").replace(/[ae]i/g, "e").replace(/h/g, "")
    .replace(/(.)\1+/g, "$1").replace(/(?<=..)[stxdzpe]+$/, "");

/** Edit distance, for one slip left after `sound` ("longre" / "longue"). */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** 20 for the same word, 15 if it sounds the same, 10 if it sounds one letter off. */
function wordScore(q: string, nameWords: string[]): number {
  let best = 0;
  for (const n of nameWords) {
    const [sq, sn] = [sound(q), sound(n)];
    if (q === n) return 20;
    if (sq === sn) best = Math.max(best, 15);
    else if (Math.min(sq.length, sn.length) >= 4 && distance(sq, sn) <= 1) {
      best = Math.max(best, 10);
    }
  }
  return best;
}

/** Largest single application advised; deeper deficits are split over several days. */
export const MAX_APPLICATION_MM = 35;

/** Latest advice date, in days after today: the engine reads 7 days ahead, Open-Meteo gives 14. */
export const MAX_DAYS_AHEAD = 7;

/** Below this aridity (annual rain ÷ annual ET0) a region is dry: the soil is not full at sowing. */
const DRY_ARIDITY = 0.5;
/** Share of the soil reserve already empty at sowing in a dry region. */
const DRY_START_SHARE = 0.3;

const PHASE_LABELS: Record<Phase, string> = {
  ini: "Initial",
  dev: "Development",
  mid: "Mid-season",
  late: "Late season",
  mature: "Mature",
};

const bad = (message: string) => new HTTPException(400, { message });

function toRecord(op: IrrigationOperation): IrrigationRecord {
  return {
    operationId: op.operationId,
    fieldId: op.fieldId,
    date: op.date,
    mm: op.mm,
    status: op.status,
  };
}

/** Report details only the FAO-56 path knows: crop stage, soil, what the numbers rely on. */
interface Details {
  sowingDate: string;
  stage: NonNullable<FieldReport["stage"]>;
  rootDepthM: number;
  textureClass: string | null;
  assumptions: string[];
}

interface Context {
  input: ReportInput;
  /** Kept separately so scenarios can rebuild the report. */
  field: Field;
  /** Null on the old model (a crop without FAO-56 data). */
  details: Details | null;
}

/** What every season context starts from. */
interface SeasonBase {
  field: Field;
  season: CropSeason;
  ref: CropRef;
  /** Confirmed, gross, on or before asOf. */
  irrigations: IrrigationInput[];
  asOf: string;
}

/** "Reel gun 1: 75 % of the pumped water reaches the roots, 20 to 40 mm per pass." */
function systemNote(system: IrrigationSystem): string {
  const { doseMinMm: min, doseMaxMm: max } = system;
  const pass = max === null
    ? (min === null ? "." : `, at least ${min} mm per pass.`)
    : (min === null ? `, at most ${max} mm per pass.` : `, ${min} to ${max} mm per pass.`);
  return `${system.name}: ${Math.round(system.efficiency * 100)} % of the pumped water reaches ` +
    "the roots" + pass;
}

const KY_STAGE_LABELS: Record<WaterTarget["stage"], string> = {
  vegetative: "before flowering",
  flowering: "flowering",
  yield_formation: "after flowering",
  ripening: "ripening",
};

/**
 * "Stage before flowering (FAO-33 Ky 0.4): water once the crop loses 20 % of its transpiration,
 * refill to 70 % of the reserve, not to field capacity."
 */
function targetNote(t: WaterTarget): string {
  const ky = t.ky === null ? "no FAO-33 Ky" : `FAO-33 Ky ${t.ky}`;
  const when = t.ksMin < 1
    ? `water once the crop loses ${Math.round((1 - t.ksMin) * 100)} % of its transpiration`
    : "water at the stress threshold";
  return `Stage ${KY_STAGE_LABELS[t.stage]} (${ky}): ${when}, refill to ` +
    `${Math.round(t.refillShare * 100)} % of the reserve, not to field capacity.`;
}

/** Stage name for people: "Flowering" once the flowering degree-days are reached in the window. */
function stageLabelOf(day: CropDay, flowered: boolean): string {
  return day.phase === "mid" && day.sensitive && flowered ? "Flowering" : PHASE_LABELS[day.phase];
}

/**
 * Adds the FAO-56 details to a report. `full` (one field) also adds the season totals and
 * the series from 10 days back to 5 days ahead; the farm advice leaves them out.
 */
function withDetails(report: FieldReport, ctx: Context, full: boolean): FieldReport {
  const d = ctx.details;
  if (!d) return report;
  const out: FieldReport = {
    ...report,
    stage: d.stage,
    rootDepthM: d.rootDepthM,
    soil: { textureClass: d.textureClass, tawMm: report.tawMm },
    assumptions: d.assumptions,
  };
  if (!full) return out;

  const { asOf } = ctx.input;
  const balance = reportBalance(ctx.input);
  // Season totals: from sowing to the day before asOf.
  const past = balance.filter((b) => b.date < asOf);
  const sum = (value: (b: DayBalance) => number) => round1(past.reduce((s, b) => s + value(b), 0));
  const pumped = ctx.input.irrigations.filter((i) => i.date >= d.sowingDate && i.date < asOf);
  out.season = {
    daysSinceSowing: daysBetween(d.sowingDate, asOf),
    rainMm: sum((b) => b.rain),
    irrigationGrossMm: round1(pumped.reduce((s, i) => s + i.mm, 0)),
    irrigationNetMm: sum((b) => b.irrigation),
    etcMm: sum((b) => b.etc),
    drainageMm: sum((b) => b.drainage),
    stressDays: past.filter((b) => b.ks < 1).length,
  };
  const from = addDays(asOf, -10);
  const to = addDays(asOf, 5);
  out.series = balance.filter((b) => b.date >= from && b.date <= to);
  return out;
}

export function createIrrigationService(
  deps: {
    data: FarmData;
    weather: WeatherService;
    today: () => string;
    /** Language of crop names in reports ("fr", "es", "it"...). Default French. */
    language?: string;
  },
): IrrigationService {
  const { data, weather } = deps;
  const language = deps.language ?? "fr";

  const checkDate = (date: string, label = "date") => {
    if (!IsoDateSchema.safeParse(date).success) {
      throw bad(`${label} must be a real date in YYYY-MM-DD format`);
    }
    return date;
  };
  /** The advice date: today by default, never after today + 7 (the forecast stops there). */
  const resolveAsOf = (asOf?: string) => {
    if (asOf === undefined) return deps.today();
    checkDate(asOf, "asOf");
    const latest = addDays(deps.today(), MAX_DAYS_AHEAD);
    if (asOf > latest) {
      throw bad(
        `date ${asOf} is more than ${MAX_DAYS_AHEAD} days ahead; the forecast reaches ${latest} at most`,
      );
    }
    return asOf;
  };

  async function getField(fieldId: number): Promise<Field> {
    const field = (await data.listFields()).find((f) => f.id === fieldId);
    if (!field) throw new HTTPException(404, { message: `field ${fieldId} not found` });
    return field;
  }

  /** Everything the engine needs for one field at `asOf`. Fetches weather only in season. */
  /** Per-call memo (one farm-advice request): shares weather and crop lookups across fields. */
  interface Memo {
    cache: Map<string, Promise<unknown>>;
  }
  const memoized = <T>(memo: Memo | undefined, key: string, load: () => Promise<T>): Promise<T> => {
    if (!memo) return load();
    let hit = memo.cache.get(key) as Promise<T> | undefined;
    if (!hit) {
      hit = load();
      memo.cache.set(key, hit);
    }
    return hit;
  };

  async function buildContext(field: Field, asOf: string, memo?: Memo): Promise<Context> {
    const season = await data.getSeasonAt(field.id, asOf);
    if (!season) {
      const { rootDepthM, p } = cropWaterParams("");
      const taw = totalAvailableWater(DEFAULT_LOAM.thetaFC, DEFAULT_LOAM.thetaWP, rootDepthM);
      return {
        field,
        details: null,
        input: {
          field,
          season: null,
          cropName: null,
          days: [],
          irrigations: [],
          taw,
          p,
          asOf,
          stageLabel: null,
          maxApplicationMm: MAX_APPLICATION_MM,
        },
      };
    }

    const code = season.cropCode;
    const group = season.earlinessGroup ?? null;
    const [ref, params, phases, ops] = await Promise.all([
      memoized(memo, `ref:${code}`, () => data.getCropRef(code)),
      memoized(memo, `params:${code}`, () => data.getCropParams(code)),
      memoized(memo, `phases:${code}:${group}`, () => data.getCropPhases(code, group)),
      data.listIrrigations(field.id, { includeDrafts: false }),
    ]);
    if (!ref) {
      throw new HTTPException(500, { message: `crop reference ${code} is missing` });
    }
    // Confirmed waterings only, and none after the chosen date: a later one did not happen yet.
    const irrigations = ops
      .filter((o) => o.status === "confirmed" && o.date <= asOf)
      .map((o) => ({ date: o.date, mm: o.mm }));

    const base = { field, season, ref, irrigations, asOf };
    // FAO-56 degree-day model when the crop has its values and phases; else the old model.
    return params && phases ? faoContext(base, params, phases, memo) : oldModelContext(base, memo);
  }

  /** Old model: Kc from the season fraction, fixed roots and p (crops without FAO-56 data). */
  async function oldModelContext(base: SeasonBase, memo?: Memo): Promise<Context> {
    const { field, season, ref, irrigations, asOf } = base;
    const [stages, soil] = await Promise.all([
      memoized(memo, `stages:${season.cropCode}`, () => data.getCropStages(season.cropCode)),
      data.getSoil(field.id),
    ]);
    const { rootDepthM, p } = cropWaterParams(season.cropCode);
    const sw = soil ? soilWaterFromTexture(soil) : DEFAULT_LOAM;
    const taw = totalAvailableWater(sw.thetaFC, sw.thetaWP, rootDepthM);

    const to = addDays(asOf, 7);
    const series = await memoized(
      memo,
      `series:${season.sowingDate}:${to}:${ref.gddBaseC}`,
      () => weather.getDailySeries({ from: season.sowingDate, to, gddBase: ref.gddBaseC }),
    );
    const total = await memoized(
      memo,
      `total:${season.sowingDate}:${season.harvestDate}:${to}:${ref.gddBaseC}`,
      () =>
        weather.seasonGddTotal({
          sowing: season.sowingDate,
          harvest: season.harvestDate,
          gddBase: ref.gddBaseC,
          knownDays: series.map((d) => ({ date: d.date, gdd: d.gdd })),
        }),
    );

    let cumulative = 0;
    let stageLabel: string | null = null;
    const days: WeatherInput[] = series.map((d) => {
      cumulative += d.gdd;
      let kc: number | null = null;
      if (d.date <= season.harvestDate) {
        const fraction = seasonFraction(cumulative, total) ?? 0;
        const point = stages.length ? kcAtFraction(stages as CropStage[], fraction) : null;
        kc = point ? point.kc : kcFromRef(ref, fraction);
        if (d.date === asOf) stageLabel = point?.stageLabel ?? null;
      }
      return { date: d.date, et0: d.et0, rain: d.rain, tmin: d.tmin, kc };
    });

    return {
      field,
      details: null,
      input: {
        field,
        season: { cropCode: season.cropCode },
        cropName: cropNameIn(ref, language),
        days,
        irrigations,
        taw,
        p,
        asOf,
        stageLabel,
        maxApplicationMm: MAX_APPLICATION_MM,
      },
    };
  }

  /**
   * FAO-56 path: degree-days from sowing give the phase, Kc, root depth and p of each day;
   * TAW grows with the roots. Soil from FAO-56 Table 19 by texture class. Dry regions start
   * with part of the reserve empty. The field's irrigation system sets efficiency and doses.
   */
  async function faoContext(
    base: SeasonBase,
    params: CropParams,
    crop: { phases: CropPhases; method: string | null },
    memo?: Memo,
  ): Promise<Context> {
    const { field, season, ref, irrigations, asOf } = base;
    const { phases } = crop;
    const to = addDays(asOf, 7);
    const [soil, classes, system, farm, ky, series] = await Promise.all([
      data.getSoil(field.id),
      memoized(memo, "soilClasses", () => data.getSoilWaterClasses()),
      data.getIrrigationSystem(field.id),
      memoized(memo, "farm", () => data.getFarm()),
      memoized(memo, `ky:${season.cropCode}`, () => data.getCropKy(season.cropCode)),
      memoized(
        memo,
        `series:${season.sowingDate}:${to}:${params.tBaseC}`,
        () => weather.getDailySeries({ from: season.sowingDate, to, gddBase: params.tBaseC }),
      ),
    ]);

    // Soil: Table 19 row of the USDA class, else Saxton-Rawls, else a typical loam.
    let sw: SoilWater = DEFAULT_LOAM;
    let textureClass: string | null = null;
    let soilNote = "No soil analysis: a typical loam is assumed.";
    if (soil) {
      const usda = usdaTextureClass(soil.sandPct, soil.clayPct);
      const fromClass = soilWaterFromClass(classes, usda);
      if (fromClass) {
        sw = fromClass;
        textureClass = usda;
        soilNote = `Soil reserve from FAO-56 Table 19 (${usda}).`;
      } else {
        sw = soilWaterFromTexture(soil);
        soilNote =
          `Soil reserve from the soil analysis (Saxton-Rawls; no Table 19 row for ${usda}).`;
      }
    }

    // Degree-days summed from sowing. `morning` = end of the day before asOf.
    let cumulative = 0;
    let morning = 0;
    let floweringDate: string | null = null;
    const gddByDate: { date: string; cum: number }[] = [];
    const days: WeatherInput[] = series.map((d) => {
      cumulative += d.tmax !== null
        ? dailyGdd({ tmin: d.tmin, tmax: d.tmax }, params.tBaseC, params.tMaxCapC)
        : Math.max(0, d.tmean - params.tBaseC);
      gddByDate.push({ date: d.date, cum: cumulative });
      if (d.date < asOf) {
        morning = cumulative;
        if (floweringDate === null && phases.flowering !== null && cumulative >= phases.flowering) {
          floweringDate = d.date;
        }
      }
      const day = cropDay(params, phases, cumulative);
      return {
        date: d.date,
        et0: d.et0,
        rain: d.rain,
        tmin: d.tmin,
        kc: d.date <= season.harvestDate ? day.kc : null,
        taw: totalAvailableWater(sw.thetaFC, sw.thetaWP, day.rootDepthM),
        pTable: day.pTable,
        pCap: day.pCap,
      };
    });
    // Phase, roots and window of the morning: they drive the decision and the stage.
    const morningDay = cropDay(params, phases, morning);
    const flowered = phases.flowering !== null && morning >= phases.flowering;
    // FAO-33 Ky of the stage: when to water and how full to refill.
    const target = waterTarget(kyStageOf(morningDay, flowered, phases.flowering !== null), ky);

    // Start date of each growth phase on the degree-day axis. Past/near dates come
    // from the weather series; a phase past the horizon is projected from the mean
    // daily degree-days so far (phenology is thermal, not water-driven).
    const lastGdd = gddByDate.length > 0 ? gddByDate[gddByDate.length - 1] : undefined;
    const avgDailyGdd = gddByDate.length > 0 && lastGdd ? lastGdd.cum / gddByDate.length : 0;
    const dateForGdd = (target: number): { startDate: string | null; forecast: boolean } => {
      if (target <= 0) return { startDate: season.sowingDate, forecast: false };
      const hit = gddByDate.find((x) => x.cum >= target);
      if (hit) return { startDate: hit.date, forecast: hit.date > asOf };
      if (!lastGdd || avgDailyGdd <= 0) return { startDate: null, forecast: true };
      const extra = Math.ceil((target - lastGdd.cum) / avgDailyGdd);
      return { startDate: addDays(lastGdd.date, extra), forecast: true };
    };
    const phaseDates = ([
      ["ini", 0],
      ["dev", phases.iniEnd],
      ["mid", phases.devEnd],
      ["late", phases.midEnd],
      ["mature", phases.lateEnd],
    ] as const).map(([phase, g]) => ({ phase, ...dateForGdd(g) }));

    // Start: soil full at sowing, except in a dry region where the whole profile (down to the
    // full root depth) starts partly empty; growing roots bring that deficit with them.
    const aridity = farm.aridityIndex ?? null;
    let dryStart: { share: number; tawMax: number } | null = null;
    let startNote = "Season start: soil full at sowing (region aridity unknown).";
    if (aridity !== null && aridity < DRY_ARIDITY) {
      dryStart = {
        share: DRY_START_SHARE,
        tawMax: totalAvailableWater(sw.thetaFC, sw.thetaWP, params.zrMaxM),
      };
      startNote = `Season start: ${DRY_START_SHARE * 100} % of the soil reserve empty, down to ` +
        `the full root depth (dry region, aridity ${round2(aridity)}).`;
    } else if (aridity !== null) {
      startNote = "Season start: soil full at sowing (wet region).";
    }

    const assumptions = [
      "Rain counted in full (no runoff).",
      startNote,
      soilNote,
      `Degree-days from sowing, base ${params.tBaseC} °C` +
      (params.tMaxCapC === null ? "." : `, Tmax capped at ${params.tMaxCapC} °C.`),
      ...(crop.method ? [`Crop stages: ${crop.method}`] : []),
      system ? systemNote(system) : "No irrigation system recorded: pumped water counted in full.",
      targetNote(target),
    ];
    const firstForecast = series.find((d) => d.source === "open-meteo");
    if (firstForecast) {
      assumptions.push(
        firstForecast.date > season.sowingDate
          ? `Weather after ${addDays(firstForecast.date, -1)} from Open-Meteo.`
          : "Weather from Open-Meteo.",
      );
    }

    return {
      field,
      details: {
        sowingDate: season.sowingDate,
        stage: {
          phase: morningDay.phase,
          gddSinceSowing: Math.round(morning),
          sensitive: morningDay.sensitive,
          floweringDate,
          phases: phaseDates,
        },
        rootDepthM: round2(morningDay.rootDepthM),
        textureClass,
        assumptions,
      },
      input: {
        field,
        season: { cropCode: season.cropCode },
        cropName: cropNameIn(ref, language),
        days,
        irrigations,
        // Fallbacks for a day without its own values (the days all carry them).
        taw: totalAvailableWater(sw.thetaFC, sw.thetaWP, morningDay.rootDepthM),
        p: Math.min(morningDay.pTable, morningDay.pCap ?? Infinity),
        asOf,
        stageLabel: stageLabelOf(morningDay, flowered),
        maxApplicationMm: MAX_APPLICATION_MM,
        system: system
          ? {
            efficiency: system.efficiency,
            doseMinMm: system.doseMinMm,
            doseMaxMm: system.doseMaxMm,
            roundDays: system.roundDays,
          }
          : null,
        phase: morningDay.phase,
        dryStart,
        target,
      },
    };
  }

  async function reportFor(
    field: Field,
    asOf: string,
    memo?: Memo,
    full = false,
  ): Promise<FieldReport> {
    const ctx = await buildContext(field, asOf, memo);
    return withDetails(buildFieldReport(ctx.input), ctx, full);
  }

  async function validateIrrigation(
    input: { fieldId: number; date: string; mm: number },
  ) {
    checkDate(input.date);
    if (!Number.isFinite(input.mm) || input.mm <= 0 || input.mm > 200) {
      throw bad("mm must be greater than 0 and at most 200");
    }
    if (input.date > deps.today()) {
      throw bad(
        `date ${input.date} is in the future; only past or current irrigations can be recorded`,
      );
    }
    const field = await getField(input.fieldId);
    const season = await data.getSeasonAt(field.id, input.date);
    if (!season) throw bad(`no crop is growing on ${field.name} on ${input.date}`);
    return { field, season };
  }

  async function findOperation(operationId: number): Promise<IrrigationOperation> {
    const op = await data.getIrrigation(operationId);
    if (!op) {
      throw new HTTPException(404, { message: `irrigation operation ${operationId} not found` });
    }
    return op;
  }

  /** Only confirmed irrigations can be corrected: drafts and planned rows are refused. */
  async function findConfirmedIrrigation(operationId: number): Promise<IrrigationOperation> {
    const op = await findOperation(operationId);
    if (op.status !== "confirmed") {
      throw new HTTPException(409, {
        message:
          `irrigation operation ${operationId} is ${op.status}; only confirmed irrigations can be corrected`,
      });
    }
    return op;
  }

  /** The operation to correct, its field and its current values. */
  async function correctionBase(operationId: number) {
    const op = await findConfirmedIrrigation(operationId);
    const field = await getField(op.fieldId);
    return {
      operationId: op.operationId,
      fieldId: field.id,
      fieldName: field.name,
      before: { date: op.date, mm: op.mm },
    };
  }

  async function planDelete(operationId: number): Promise<IrrigationCorrectionPreview> {
    const base = await correctionBase(operationId);
    const { before, fieldName } = base;
    return {
      ...base,
      action: "delete",
      after: null,
      summary: `Delete the irrigation of ${before.mm} mm on ${fieldName} on ${before.date}?`,
    };
  }

  /**
   * An update passes the checks of a new record (date not in the future, mm in (0, 200], a crop
   * season on the new date) and must change something. The season is the one on the new date.
   */
  async function planUpdate(operationId: number, change: { date?: string; mm?: number }) {
    if (change.date === undefined && change.mm === undefined) {
      throw bad("an update needs the new date or the new mm");
    }
    const base = await correctionBase(operationId);
    const { before, fieldName } = base;
    const after = { date: change.date ?? before.date, mm: change.mm ?? before.mm };
    const { season } = await validateIrrigation({ fieldId: base.fieldId, ...after });
    if (after.date === before.date && after.mm === before.mm) {
      throw bad(`the irrigation is already ${before.mm} mm on ${before.date}; nothing to change`);
    }
    const preview: IrrigationCorrectionPreview = {
      ...base,
      action: "update",
      after,
      summary: `Change the irrigation on ${fieldName} from ${before.mm} mm on ${before.date} ` +
        `to ${after.mm} mm on ${after.date}?`,
    };
    return {
      preview,
      change: { ...after, seasonId: season.id, dateChanged: after.date !== before.date },
    };
  }

  async function create(
    input: IrrigationDraftInput & { source: OperationSource },
    status: OperationStatus,
  ): Promise<IrrigationRecord> {
    const { field, season } = await validateIrrigation(input);
    if (input.memberId !== null && !(await data.getMember(input.memberId))) {
      throw bad(`unknown member ${input.memberId}`);
    }
    return toRecord(
      await data.createIrrigation({
        fieldId: field.id,
        seasonId: season.id,
        date: input.date,
        mm: input.mm,
        status,
        source: input.source,
        memberId: input.memberId,
      }),
    );
  }

  return {
    ...createFarmInfoService({ data, today: deps.today, language }),
    ...createProductCheckService({ data, today: deps.today, language }),
    ...createFarmLookupService({ data, today: deps.today, language }),

    today: () => deps.today(),

    async defaultMemberId() {
      return (await data.listMembers()).find((m) => m.mainContact)?.id ?? null;
    },

    async resolveField(query) {
      const q = normalize(query);
      if (!q) return [];
      const qWords = words(query);
      const asOf = deps.today();
      const out: (FieldMatch & { score: number })[] = [];
      // Crops of every field in parallel: one by one, a farm's ~20 lookups took ~1.5 s.
      const fields = await Promise.all(
        (await data.listFields()).map(async (field) => {
          const season = await data.getSeasonAt(field.id, asOf);
          return { field, ref: season ? await data.getCropRef(season.cropCode) : null };
        }),
      );
      for (const { field, ref } of fields) {
        const name = normalize(field.name);
        // Any language the farmer may use: "maïs", "maíz", "mais", "maize"...
        const crops = ref
          ? [...new Set(Object.values(ref.names).concat(ref.nameEn))].map(normalize)
          : [];

        let score = 0;
        if (q === name) score = 100;
        else if (q.length >= 3 && (name.includes(q) || q.includes(name))) score = 60;
        else if (
          crops.some((c) =>
            q === c || (q.length >= 3 && (c.includes(q) || q.includes(c))) ||
            qWords.some((w) => c.split(" ").includes(w))
          )
        ) score = 40;
        else {
          const nameWords = words(field.name);
          score = qWords.reduce((sum, w) => sum + wordScore(w, nameWords), 0);
        }
        if (score > 0) {
          out.push({
            fieldId: field.id,
            name: field.name,
            cropName: ref ? cropNameIn(ref, language) : null,
            score,
          });
        }
      }
      return out
        .sort((a, b) => b.score - a.score || a.fieldId - b.fieldId)
        .map(({ score: _s, ...m }) => m);
    },

    async getFieldReport(fieldId, asOf, opts) {
      const date = resolveAsOf(asOf);
      return reportFor(await getField(fieldId), date, undefined, opts?.full ?? true);
    },

    async getFarmAdvice(asOf) {
      const date = resolveAsOf(asOf);
      const fields = await data.listFields();
      const memo: Memo = { cache: new Map() };
      const reports = await Promise.all(fields.map((f) => reportFor(f, date, memo)));
      return { asOf: date, reports: rankReports(reports) };
    },

    async simulateScenario(fieldId, events, asOf) {
      const date = resolveAsOf(asOf);
      const field = await getField(fieldId);
      const ctx = await buildContext(field, date);
      const baseline = withDetails(buildFieldReport(ctx.input), ctx, false);
      // Events may add waterings after the date: they are applied after the date filter.
      const applied = applyScenario(ctx.input.days, ctx.input.irrigations, events);
      const scenarioInput: ReportInput = {
        ...ctx.input,
        days: applied.days,
        irrigations: applied.irrigations,
        extraWarnings: applied.warnings,
      };
      const scenario = withDetails(
        buildFieldReport(scenarioInput),
        { ...ctx, input: scenarioInput },
        false,
      );
      const from = addDays(date, -14);
      const to = addDays(date, 6);
      // Same TAW, p, start and efficiency as the reports.
      const series: DayBalance[] = reportBalance(scenarioInput)
        .filter((d) => d.date >= from && d.date <= to);
      return {
        asOf: date,
        baseline,
        scenario,
        comparison: compareReports(baseline, scenario),
        series,
      };
    },

    async getWeather(fieldId, asOf) {
      const date = resolveAsOf(asOf);
      const field = await getField(fieldId);
      const season = await data.getSeasonAt(field.id, date);
      const ref = season ? await data.getCropRef(season.cropCode) : null;
      const series = await weather.getDailySeries({
        from: addDays(date, -3),
        to: addDays(date, 3),
        gddBase: ref?.gddBaseC ?? 6,
      });
      return series.map(({ gdd: _gdd, ...day }) => day);
    },

    async previewIrrigation(input) {
      const { field } = await validateIrrigation(input);
      return {
        fieldId: field.id,
        fieldName: field.name,
        date: input.date,
        mm: input.mm,
        summary: `Record ${input.mm} mm on ${field.name} for ${input.date}?`,
      };
    },

    createDraftIrrigation: (input) => create({ ...input, source: "agent" }, "draft"),

    async confirmIrrigation(operationId) {
      const op = await findOperation(operationId);
      if (op.status === "confirmed") return toRecord(op);
      return toRecord(await data.setIrrigationStatus(operationId, "confirmed"));
    },

    async cancelIrrigation(operationId) {
      const op = await findOperation(operationId);
      if (op.status !== "draft") {
        throw new HTTPException(409, {
          message:
            `irrigation operation ${operationId} is ${op.status}; only drafts can be cancelled`,
        });
      }
      await data.deleteIrrigation(operationId);
    },

    recordIrrigation: (input) => create(input, "confirmed"),

    async listIrrigations(fieldId, range = {}) {
      const field = await getField(fieldId);
      const { from, to } = range;
      return (await data.listIrrigations(field.id, { includeDrafts: false }))
        .filter((o) =>
          o.status === "confirmed" && (!from || o.date >= from) && (!to || o.date <= to)
        )
        .sort((a, b) => b.date.localeCompare(a.date) || b.operationId - a.operationId)
        .map(toRecord);
    },

    async previewIrrigationCorrection({ operationId, action, date, mm }) {
      if (action === "delete") return planDelete(operationId);
      if (action === "update") return (await planUpdate(operationId, { date, mm })).preview;
      throw bad("action must be update or delete");
    },

    async updateIrrigation(operationId, change) {
      const plan = await planUpdate(operationId, change);
      return toRecord(await data.updateIrrigation(operationId, plan.change));
    },

    async deleteIrrigation(operationId) {
      const op = await findConfirmedIrrigation(operationId);
      await data.deleteIrrigation(operationId);
      return toRecord(op);
    },
  };
}
