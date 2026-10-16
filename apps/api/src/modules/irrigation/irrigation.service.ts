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
import {
  cropNameIn,
  type CropStage,
  type FarmData,
  type Field,
  type IrrigationOperation,
  type OperationStatus,
} from "./data/farmData";
import { cropWaterParams, kcAtFraction, kcFromRef, seasonFraction } from "./engine/crop";
import { buildFieldReport, rankReports, type ReportInput } from "./engine/report";
import { applyScenario, compareReports } from "./engine/scenario";
import { DEFAULT_LOAM, soilWaterFromTexture, totalAvailableWater } from "./engine/soil";
import { addDays } from "./engine/util";
import { runWaterBalance, type WeatherInput } from "./engine/waterBalance";
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

export interface IrrigationService {
  today(): string;
  /** Main contact's member id, or null when the farm has none. */
  defaultMemberId(): Promise<number | null>;
  resolveField(query: string): Promise<FieldMatch[]>;
  getFieldReport(fieldId: number, asOf?: string): Promise<FieldReport>;
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
    input: IrrigationDraftInput & { source: string },
  ): Promise<IrrigationRecord>;
  listIrrigations(
    fieldId: number,
    range?: { from?: string; to?: string },
  ): Promise<IrrigationRecord[]>;
}

const normalize = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (s: string) => normalize(s).split(" ").filter((w) => w.length > 2);

/** Largest single application advised; deeper deficits are split over several days. */
export const MAX_APPLICATION_MM = 35;

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

interface Context {
  input: ReportInput;
  /** Kept separately so scenarios can rebuild the report. */
  field: Field;
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
  const resolveAsOf = (asOf?: string) =>
    asOf === undefined ? deps.today() : checkDate(asOf, "asOf");

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

    const [ref, stages, soil, ops] = await Promise.all([
      memoized(memo, `ref:${season.cropCode}`, () => data.getCropRef(season.cropCode)),
      memoized(memo, `stages:${season.cropCode}`, () => data.getCropStages(season.cropCode)),
      data.getSoil(field.id),
      data.listIrrigations(field.id, { includeDrafts: false }),
    ]);
    if (!ref) {
      throw new HTTPException(500, { message: `crop reference ${season.cropCode} is missing` });
    }
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

    const irrigations = ops
      .filter((o) => o.status === "confirmed")
      .map((o) => ({ date: o.date, mm: o.mm }));

    return {
      field,
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

  async function reportFor(field: Field, asOf: string, memo?: Memo): Promise<FieldReport> {
    return buildFieldReport((await buildContext(field, asOf, memo)).input);
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

  async function create(
    input: IrrigationDraftInput & { source: string },
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
      for (const field of await data.listFields()) {
        const name = normalize(field.name);
        const season = await data.getSeasonAt(field.id, asOf);
        const ref = season ? await data.getCropRef(season.cropCode) : null;
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
          const nameWords = new Set(words(field.name));
          score = 20 * qWords.filter((w) => nameWords.has(w)).length;
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

    async getFieldReport(fieldId, asOf) {
      const date = resolveAsOf(asOf);
      return reportFor(await getField(fieldId), date);
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
      const { input } = await buildContext(field, date);
      const baseline = buildFieldReport(input);
      const applied = applyScenario(input.days, input.irrigations, events);
      const scenarioInput: ReportInput = {
        ...input,
        days: applied.days,
        irrigations: applied.irrigations,
        extraWarnings: applied.warnings,
      };
      const scenario = buildFieldReport(scenarioInput);
      const from = addDays(date, -14);
      const to = addDays(date, 6);
      const series: DayBalance[] = runWaterBalance({
        days: applied.days,
        irrigations: applied.irrigations,
        taw: input.taw,
        p: input.p,
      }).filter((d) => d.date >= from && d.date <= to);
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

    createDraftIrrigation: (input) => create({ ...input, source: "assistant" }, "draft"),

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
  };
}
