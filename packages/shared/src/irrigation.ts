import { z } from "zod";

// ---------------------------------------------------------------------------
// Irrigation advisor + chat contracts. Every number is produced by the
// deterministic FAO-56 engine in apps/api; the AI only narrates them.
// ---------------------------------------------------------------------------

/** Calendar date, `YYYY-MM-DD`. */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }, "not a real calendar date");
export type IsoDate = z.infer<typeof IsoDateSchema>;

export const DecisionSchema = z.enum([
  "irrigate_today",
  "frost_hold",
  "wait_for_rain",
  /** Stress comes within the irrigation system's round days: water by `irrigateBy`. */
  "plan_irrigation",
  "no_irrigation",
  /** Late phase or mature: stop irrigating. */
  "crop_maturing",
  "not_irrigable",
  "outside_season",
]);
export type Decision = z.infer<typeof DecisionSchema>;

/** Crop phase on the degree-day axis (FAO-56 stages, then mature). */
export const PhaseSchema = z.enum(["ini", "dev", "mid", "late", "mature"]);
export type CropPhase = z.infer<typeof PhaseSchema>;

/** One day of the water balance series. */
export const DayBalanceSchema = z.object({
  date: IsoDateSchema,
  et0: z.number(),
  kc: z.number(),
  ks: z.number(),
  etc: z.number(),
  rain: z.number(),
  /** Net: the water that reached the roots (gross × efficiency). */
  irrigation: z.number(),
  /** Water above field capacity that left the root zone. */
  drainage: z.number(),
  depletion: z.number(),
  taw: z.number(),
  /** Depletion fraction of the day; RAW = p × TAW. */
  p: z.number(),
  raw: z.number(),
});
export type DayBalance = z.infer<typeof DayBalanceSchema>;

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
  /** Water to pump, mm: `irrigateMm` (net) ÷ efficiency, capped per pass. */
  irrigateGrossMm: z.number(),
  /** Last day to water (today for irrigate_today and frost_hold), else null. */
  irrigateBy: IsoDateSchema.nullable(),
  /** One short sentence for voice and SMS. */
  headline: z.string(),
  // Details below; the farm advice may leave them out.
  stage: z.object({
    phase: PhaseSchema,
    /** Degree-days since sowing. */
    gddSinceSowing: z.number(),
    /** In the stress-sensitive window (p capped). */
    sensitive: z.boolean(),
    /** Day the flowering degree-days were reached, null if not yet. */
    floweringDate: IsoDateSchema.nullable(),
  }).nullable().optional(),
  rootDepthM: z.number().nullable().optional(),
  soil: z.object({
    /** USDA texture class, null when the TAW comes from another method. */
    textureClass: z.string().nullable(),
    tawMm: z.number(),
  }).nullable().optional(),
  /** Totals from sowing to the day before `asOf`. Water in mm. */
  season: z.object({
    daysSinceSowing: z.number().int(),
    rainMm: z.number(),
    irrigationGrossMm: z.number(),
    irrigationNetMm: z.number(),
    etcMm: z.number(),
    drainageMm: z.number(),
    stressDays: z.number().int(),
  }).optional(),
  series: z.array(DayBalanceSchema).optional(),
  /** What the numbers rely on, in plain words. */
  assumptions: z.array(z.string()).optional(),
});
export type FieldReport = z.infer<typeof FieldReportSchema>;

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
  /** Water to pump (`irrigateGrossMm`), mm, before and after the scenario. */
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
  tmax: z.number().nullable().optional(),
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
