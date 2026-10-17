import { z } from "zod";
import { IsoDateSchema } from "./irrigation";

// ---------------------------------------------------------------------------
// Farm contracts beyond irrigation: field details and the farm journal.
// Every number and total is computed by the API (apps/api); the AI only reads them.
// Names avoid the db.ts / app.ts exports re-exported by index.ts (no `FieldSchema`,
// `SoilSchema`, `OperationSchema` here).
// ---------------------------------------------------------------------------

// --- Field details (chat tool getFieldDetails, phone get_field_details) -----

/** The crop growing on the field today. */
export const FieldDetailsCropSchema = z.object({
  seasonId: z.number().int(),
  code: z.string(),
  /** In the farm's language. */
  name: z.string(),
  variety: z.string().nullable(),
  earlinessGroup: z.string().nullable(),
  sowingDate: IsoDateSchema.nullable(),
  /** Expected harvest unless the status is harvested. */
  harvestDate: IsoDateSchema.nullable(),
  status: z.string(),
  previousCropName: z.string().nullable(),
});
export type FieldDetailsCrop = z.infer<typeof FieldDetailsCropSchema>;

/** The field's irrigation equipment. Doses are gross mm. */
export const FieldDetailsSystemSchema = z.object({
  name: z.string(),
  /** reel_gun, pivot, sprinkler or drip. */
  type: z.string().nullable(),
  /** Share of pumped water that reaches the roots (0–1). */
  efficiency: z.number(),
  doseMinMm: z.number().nullable(),
  doseMaxMm: z.number().nullable(),
  roundDays: z.number().nullable(),
});
export type FieldDetailsSystem = z.infer<typeof FieldDetailsSystemSchema>;

/** The latest soil analysis of the field. */
export const FieldDetailsSoilSchema = z.object({
  sampledOn: IsoDateSchema.nullable(),
  /** USDA texture class from sand and clay (engine `usdaTextureClass`). */
  textureClass: z.string().nullable(),
  sandPct: z.number().nullable(),
  siltPct: z.number().nullable(),
  clayPct: z.number().nullable(),
  organicMatterPct: z.number().nullable(),
  ph: z.number().nullable(),
  nitrogenGKg: z.number().nullable(),
  phosphorusMgKg: z.number().nullable(),
  potassiumMgKg: z.number().nullable(),
  sulfurMgKg: z.number().nullable(),
  calciumMgKg: z.number().nullable(),
  magnesiumMgKg: z.number().nullable(),
  zincMgKg: z.number().nullable(),
  boronMgKg: z.number().nullable(),
  cecCmolKg: z.number().nullable(),
  bulkDensityKgDm3: z.number().nullable(),
  limeRequirementTHa: z.number().nullable(),
});
export type FieldDetailsSoil = z.infer<typeof FieldDetailsSoilSchema>;

export const FieldDetailsSchema = z.object({
  field: z.object({
    id: z.number().int(),
    name: z.string(),
    areaHa: z.number(),
    /** owned, rented... */
    tenure: z.string().nullable(),
    irrigable: z.boolean(),
  }),
  crop: FieldDetailsCropSchema.nullable(),
  irrigationSystem: FieldDetailsSystemSchema.nullable(),
  soil: FieldDetailsSoilSchema.nullable(),
});
export type FieldDetails = z.infer<typeof FieldDetailsSchema>;

// --- Farm journal (chat tool getFieldJournal, phone get_field_journal) ------

/** Operation types of the journal (`operation.op_type`). */
export const JOURNAL_TYPES = [
  "sowing",
  "fertilisation",
  "spraying",
  "irrigation",
  "harvest",
  "tillage",
  "observation",
  "other",
] as const;
export const JournalTypeSchema = z.enum(JOURNAL_TYPES);
export type JournalType = z.infer<typeof JournalTypeSchema>;

/** At most this many entries come back; `truncated` says when there were more. */
export const JOURNAL_MAX_ENTRIES = 20;

/** A product used in an operation. Dose is per hectare. */
export const JournalProductSchema = z.object({
  productName: z.string(),
  dose: z.number().nullable(),
  doseUnit: z.string().nullable(),
  target: z.string().nullable(),
});
export type JournalProduct = z.infer<typeof JournalProductSchema>;

/** One journal row. Values that do not apply to the type are left out. */
export const JournalEntrySchema = z.object({
  operationId: z.number().int(),
  date: IsoDateSchema,
  type: JournalTypeSchema,
  fieldId: z.number().int(),
  fieldName: z.string(),
  /** Drafts and cancelled rows never appear. */
  status: z.enum(["confirmed", "planned"]),
  /** Not done yet: planned, or dated after today. */
  planned: z.boolean(),
  /** Crop stage (BBCH) on the day. */
  bbch: z.number().int().nullable(),
  fertiliserType: z.string().optional(),
  nKgHa: z.number().optional(),
  p2o5KgHa: z.number().optional(),
  k2oKgHa: z.number().optional(),
  waterMm: z.number().optional(),
  variety: z.string().optional(),
  seedRateKgHa: z.number().optional(),
  yieldTHa: z.number().optional(),
  moisturePct: z.number().optional(),
  proteinPct: z.number().optional(),
  method: z.string().optional(),
  notes: z.string().optional(),
  products: z.array(JournalProductSchema),
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

/** Totals over every done entry of the range (not only the entries shown). */
export const JournalTotalsSchema = z.object({
  /** Done entries (planned ones are not counted). */
  count: z.number().int(),
  /** Done entries per type; types with none are left out. */
  byType: z.partialRecord(JournalTypeSchema, z.number().int()),
  /** Summed over fertilisations, kg/ha. Null when the entries cover several fields. */
  nKgHa: z.number().nullable(),
  p2o5KgHa: z.number().nullable(),
  k2oKgHa: z.number().nullable(),
  /** Summed over irrigations, mm. Null when the entries cover several fields. */
  irrigationMm: z.number().nullable(),
  /** Number of spraying operations. */
  sprays: z.number().int(),
  /** Planned entries in the range, left out of every total above. */
  planned: z.number().int(),
});
export type JournalTotals = z.infer<typeof JournalTotalsSchema>;

export const FieldJournalSchema = z.object({
  /** Null: every field of the farm. */
  fieldId: z.number().int().nullable(),
  fieldName: z.string().nullable(),
  /** Null: every type. */
  type: JournalTypeSchema.nullable(),
  from: IsoDateSchema,
  to: IsoDateSchema,
  /** Newest first, at most JOURNAL_MAX_ENTRIES. */
  entries: z.array(JournalEntrySchema),
  totals: JournalTotalsSchema,
  /** True when the range has more entries than shown. */
  truncated: z.boolean(),
});
export type FieldJournal = z.infer<typeof FieldJournalSchema>;
