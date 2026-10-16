import { z } from "zod";

// ---------------------------------------------------------------------------
// Irrigation advisor + chat contracts. Every number is produced by the
// deterministic FAO-56 engine in apps/api; the AI only narrates them.
// ---------------------------------------------------------------------------

/** Calendar date, `YYYY-MM-DD`. */
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
export type IsoDate = z.infer<typeof IsoDateSchema>;

export const DecisionSchema = z.enum([
  "irrigate_today",
  "frost_hold",
  "wait_for_rain",
  "no_irrigation",
  "not_irrigable",
  "outside_season",
]);
export type Decision = z.infer<typeof DecisionSchema>;

/** Advice for one field on one day. Water amounts in mm, depletion in mm of the root zone. */
export const FieldReportSchema = z.object({
  fieldId: z.number().int(),
  fieldName: z.string(),
  irrigable: z.boolean(),
  cropCode: z.string().nullable(),
  cropName: z.string().nullable(),
  asOf: IsoDateSchema,
  stageLabel: z.string().nullable(),
  /** Crop coefficient, 2 decimals. */
  kc: z.number().nullable(),
  decision: DecisionSchema,
  irrigateMm: z.number(),
  /** 1 decimal. */
  depletionMm: z.number(),
  tawMm: z.number(),
  rawMm: z.number(),
  /** Integer percent of TAW. */
  depletionPct: z.number().int(),
  daysUntilIrrigation: z.number().int().nullable(),
  rainNext3DaysMm: z.number(),
  reason: z.string(),
  warnings: z.array(z.string()),
});
export type FieldReport = z.infer<typeof FieldReportSchema>;

/** One day of the water balance series. */
export const DayBalanceSchema = z.object({
  date: IsoDateSchema,
  et0: z.number(),
  kc: z.number(),
  ks: z.number(),
  etc: z.number(),
  rain: z.number(),
  irrigation: z.number(),
  depletion: z.number(),
  taw: z.number(),
  raw: z.number(),
});
export type DayBalance = z.infer<typeof DayBalanceSchema>;

/** What-if events applied on top of the baseline. */
export const ScenarioEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("irrigation"),
    date: IsoDateSchema,
    mm: z.number().positive().max(200),
  }),
  z.object({
    type: z.literal("rain"),
    date: IsoDateSchema,
    mm: z.number().positive().max(300),
  }),
  z.object({
    type: z.literal("drought"),
    date: IsoDateSchema,
    days: z.number().int().min(1).max(30),
    et0Factor: z.number().min(1).max(2).default(1.3),
  }),
  z.object({
    type: z.literal("flood"),
    date: IsoDateSchema,
    mm: z.number().min(50).max(400).default(120),
  }),
  z.object({
    type: z.literal("frost"),
    date: IsoDateSchema,
    tmin: z.number().max(0).default(-3),
  }),
  z.object({
    type: z.literal("hail"),
    date: IsoDateSchema,
  }),
]);
export type ScenarioEvent = z.infer<typeof ScenarioEventSchema>;

export const ScenarioComparisonSchema = z.object({
  decisionChanged: z.boolean(),
  mmBefore: z.number(),
  mmAfter: z.number(),
  summary: z.string(),
});
export type ScenarioComparison = z.infer<typeof ScenarioComparisonSchema>;

export const ScenarioResultSchema = z.object({
  asOf: IsoDateSchema,
  baseline: FieldReportSchema,
  scenario: FieldReportSchema,
  comparison: ScenarioComparisonSchema,
  series: z.array(DayBalanceSchema),
});
export type ScenarioResult = z.infer<typeof ScenarioResultSchema>;

export const FarmAdviceSchema = z.object({
  asOf: IsoDateSchema,
  reports: z.array(FieldReportSchema),
});
export type FarmAdvice = z.infer<typeof FarmAdviceSchema>;

export const WeatherDaySchema = z.object({
  date: IsoDateSchema,
  et0: z.number(),
  rain: z.number(),
  tmin: z.number(),
  tmean: z.number(),
  source: z.enum(["db", "open-meteo"]),
});
export type WeatherDay = z.infer<typeof WeatherDaySchema>;

export const IrrigationRecordSchema = z.object({
  operationId: z.number().int(),
  fieldId: z.number().int(),
  date: IsoDateSchema,
  mm: z.number(),
  status: z.string(),
});
export type IrrigationRecord = z.infer<typeof IrrigationRecordSchema>;

// ---------------------------------------------------------------------------
// Request bodies / queries
// ---------------------------------------------------------------------------

export const SimulateBodySchema = z.object({
  events: z.array(ScenarioEventSchema).min(1).max(10),
  date: IsoDateSchema.optional(),
});
export type SimulateBody = z.infer<typeof SimulateBodySchema>;

export const RecordIrrigationBodySchema = z.object({
  fieldId: z.number().int(),
  date: IsoDateSchema,
  mm: z.number().positive().max(200),
  memberId: z.number().int().optional(),
});
export type RecordIrrigationBody = z.infer<typeof RecordIrrigationBodySchema>;

export const AdviceQuerySchema = z.object({
  date: IsoDateSchema.optional(),
});
export type AdviceQuery = z.infer<typeof AdviceQuerySchema>;
