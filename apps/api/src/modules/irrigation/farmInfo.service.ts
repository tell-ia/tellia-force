// Field details and the farm journal: read-only use cases for the chat and phone tools.
// Every number and total is computed here, never by the LLM. Wired into the irrigation
// service (createIrrigationService), so each farm scope has one service object.

import { HTTPException } from "hono/http-exception";
import { IsoDateSchema } from "@tellia/shared/irrigation";
import {
  type FieldDetails,
  type FieldJournal,
  JOURNAL_MAX_ENTRIES,
  type JournalEntry,
  type JournalTotals,
  type JournalType,
} from "@tellia/shared/farm";
import { cropNameIn, type FarmData, type FarmOperation, type Field } from "./data/farmData";
import { usdaTextureClass } from "./engine/soil";
import { addDays, round1 } from "./engine/util";

export interface JournalQuery {
  /** Missing: every field of the farm. */
  fieldId?: number;
  type?: JournalType;
  from?: string;
  to?: string;
}

export interface FarmInfoService {
  /** A field with its crop today, irrigation system and latest soil analysis. */
  getFieldDetails(fieldId: number): Promise<FieldDetails>;
  /**
   * Journal entries, newest first (at most JOURNAL_MAX_ENTRIES), with totals over the whole
   * range. Default range: the field's crop season today (sowing to harvest); with no field, or
   * no crop today, the last JOURNAL_DAYS_BACK days up to today + JOURNAL_DAYS_AHEAD.
   */
  getFieldJournal(query?: JournalQuery): Promise<FieldJournal>;
}

export const JOURNAL_DAYS_BACK = 365;
export const JOURNAL_DAYS_AHEAD = 30;

/** Type values copied to an entry when present. */
const VALUE_KEYS = [
  "fertiliserType",
  "nKgHa",
  "p2o5KgHa",
  "k2oKgHa",
  "waterMm",
  "variety",
  "seedRateKgHa",
  "yieldTHa",
  "moisturePct",
  "proteinPct",
  "method",
  "notes",
] as const satisfies readonly (keyof FarmOperation & keyof JournalEntry)[];

const bad = (message: string) => new HTTPException(400, { message });

const finite = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function createFarmInfoService(
  deps: { data: FarmData; today: () => string; language: string },
): FarmInfoService {
  const { data, language } = deps;

  async function getField(fieldId: number): Promise<Field> {
    const field = (await data.listFields()).find((f) => f.id === fieldId);
    if (!field) throw new HTTPException(404, { message: `field ${fieldId} not found` });
    return field;
  }

  const checkDate = (date: string, label: string) => {
    if (!IsoDateSchema.safeParse(date).success) {
      throw bad(`${label} must be a real date in YYYY-MM-DD format`);
    }
  };

  /** Not done yet: planned, or dated after today. */
  const isPlanned = (o: FarmOperation, today: string) => o.status === "planned" || o.date > today;

  function toEntry(o: FarmOperation, fieldName: string, today: string): JournalEntry {
    const entry: JournalEntry = {
      operationId: o.operationId,
      date: o.date,
      type: o.type,
      fieldId: o.fieldId,
      fieldName,
      status: o.status === "planned" ? "planned" : "confirmed",
      planned: isPlanned(o, today),
      bbch: o.bbch ?? null,
      products: o.products.map((p) => ({
        productName: p.productName,
        dose: p.dose,
        doseUnit: p.doseUnit,
        target: p.target,
      })),
    };
    const values = entry as Record<string, unknown>;
    for (const key of VALUE_KEYS) {
      const v = o[key];
      if (v != null) values[key] = v;
    }
    return entry;
  }

  /** Totals over the done rows; per-hectare sums only make sense on one field. */
  function totalsOf(rows: FarmOperation[], today: string): JournalTotals {
    const done = rows.filter((o) => !isPlanned(o, today));
    const byType: Partial<Record<JournalType, number>> = {};
    for (const o of done) byType[o.type] = (byType[o.type] ?? 0) + 1;
    const oneField = new Set(done.map((o) => o.fieldId)).size <= 1;
    const sum = (type: JournalType, value: (o: FarmOperation) => number | null | undefined) =>
      oneField
        ? round1(
          done.filter((o) => o.type === type).reduce((s, o) => {
            const v = value(o);
            return s + (finite(v) ? v : 0);
          }, 0),
        )
        : null;
    return {
      count: done.length,
      byType,
      nKgHa: sum("fertilisation", (o) => o.nKgHa),
      p2o5KgHa: sum("fertilisation", (o) => o.p2o5KgHa),
      k2oKgHa: sum("fertilisation", (o) => o.k2oKgHa),
      irrigationMm: sum("irrigation", (o) => o.waterMm),
      sprays: byType.spraying ?? 0,
      planned: rows.length - done.length,
    };
  }

  return {
    async getFieldDetails(fieldId) {
      const field = await getField(fieldId);
      const [season, system, soil] = await Promise.all([
        data.getSeasonAt(field.id, deps.today()),
        data.getIrrigationSystem(field.id),
        data.getSoil(field.id),
      ]);

      let crop: FieldDetails["crop"] = null;
      if (season) {
        const previous = season.previousCropCode ?? null;
        const [ref, previousRef] = await Promise.all([
          data.getCropRef(season.cropCode),
          previous ? data.getCropRef(previous) : Promise.resolve(null),
        ]);
        crop = {
          seasonId: season.id,
          code: season.cropCode,
          name: ref ? cropNameIn(ref, language) : season.cropCode,
          variety: season.variety ?? null,
          earlinessGroup: season.earlinessGroup ?? null,
          sowingDate: season.sowingDate ?? null,
          harvestDate: season.harvestDate ?? null,
          status: season.status,
          previousCropName: previousRef ? cropNameIn(previousRef, language) : previous,
        };
      }

      const sand = soil?.sandPct ?? null;
      const clay = soil?.clayPct ?? null;
      return {
        field: {
          id: field.id,
          name: field.name,
          areaHa: field.areaHa,
          tenure: field.tenure ?? null,
          irrigable: field.irrigable,
        },
        crop,
        irrigationSystem: system
          ? {
            name: system.name,
            type: system.type ?? null,
            efficiency: system.efficiency,
            doseMinMm: system.doseMinMm,
            doseMaxMm: system.doseMaxMm,
            roundDays: system.roundDays,
          }
          : null,
        soil: soil
          ? {
            sampledOn: soil.sampledOn ?? null,
            textureClass: finite(sand) && finite(clay) ? usdaTextureClass(sand, clay) : null,
            sandPct: sand,
            siltPct: soil.siltPct ?? null,
            clayPct: clay,
            organicMatterPct: soil.organicMatterPct ?? null,
            ph: soil.ph ?? null,
            nitrogenGKg: soil.nitrogenGKg ?? null,
            phosphorusMgKg: soil.phosphorusMgKg ?? null,
            potassiumMgKg: soil.potassiumMgKg ?? null,
            sulfurMgKg: soil.sulfurMgKg ?? null,
            calciumMgKg: soil.calciumMgKg ?? null,
            magnesiumMgKg: soil.magnesiumMgKg ?? null,
            zincMgKg: soil.zincMgKg ?? null,
            boronMgKg: soil.boronMgKg ?? null,
            cecCmolKg: soil.cecCmolKg ?? null,
            bulkDensityKgDm3: soil.bulkDensityKgDm3 ?? null,
            limeRequirementTHa: soil.limeRequirementTHa ?? null,
          }
          : null,
      };
    },

    async getFieldJournal(query = {}) {
      const today = deps.today();
      if (query.from !== undefined) checkDate(query.from, "from");
      if (query.to !== undefined) checkDate(query.to, "to");
      const field = query.fieldId === undefined ? null : await getField(query.fieldId);

      let range = {
        from: addDays(today, -JOURNAL_DAYS_BACK),
        to: addDays(today, JOURNAL_DAYS_AHEAD),
      };
      if (field) {
        const season = await data.getSeasonAt(field.id, today);
        if (season) range = { from: season.sowingDate, to: season.harvestDate };
      }
      const from = query.from ?? range.from;
      const to = query.to ?? range.to;
      if (from > to) {
        throw bad(`from ${from} is after to ${to}; give both dates`);
      }

      const [fields, rows] = await Promise.all([
        data.listFields(),
        data.listOperations({ from, to, fieldId: field?.id, type: query.type }),
      ]);
      const names = new Map(fields.map((f) => [f.id, f.name]));
      const journal = rows
        .filter((o) => o.status === "confirmed" || o.status === "planned")
        .sort((a, b) => b.date.localeCompare(a.date) || b.operationId - a.operationId);

      return {
        fieldId: field?.id ?? null,
        fieldName: field?.name ?? null,
        type: query.type ?? null,
        from,
        to,
        entries: journal.slice(0, JOURNAL_MAX_ENTRIES).map((o) =>
          toEntry(o, names.get(o.fieldId) ?? `field ${o.fieldId}`, today)
        ),
        totals: totalsOf(journal, today),
        truncated: journal.length > JOURNAL_MAX_ENTRIES,
      };
    },
  };
}
