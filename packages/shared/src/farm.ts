import { z } from "zod";
import { IsoDateSchema } from "./irrigation";

// ---------------------------------------------------------------------------
// Farm contracts beyond irrigation: field details, the farm journal and the product check.
// Every number and total is computed by the API (apps/api); the AI only reads them.
// Names avoid the db.ts / app.ts exports re-exported by index.ts (no `FieldSchema`,
// `SoilSchema`, `OperationSchema`, `ProductSchema`, `ProductUseSchema` here).
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

// --- Product check (chat tool checkProductUse, phone check_product_use) -----

/** At most this many candidates come back when several products match. */
export const PRODUCT_MATCHES_MAX = 10;

/** A product the query matched. */
export const ProductMatchSchema = z.object({
  /** Null: a product named in the farm's journal but not in the E-Phy catalogue (synthetic). */
  productId: z.number().int().nullable(),
  name: z.string(),
  /** French marketing authorisation number (AMM). */
  ammNumber: z.string().nullable(),
  /** herbicide, fungicide, insecticide... Null when unknown. */
  kind: z.string().nullable(),
  activeSubstances: z.string().nullable(),
  /** True: not in the E-Phy catalogue, so there is no authorisation data for it. */
  synthetic: z.boolean(),
});
export type ProductMatch = z.infer<typeof ProductMatchSchema>;

/** One authorised use (E-Phy `product_use`) of the product on the field's crop. */
export const ProductUseRuleSchema = z.object({
  target: z.string().nullable(),
  /** Per hectare, in doseUnit. */
  maxDose: z.number().nullable(),
  doseUnit: z.string().nullable(),
  maxApplications: z.number().int().nullable(),
  /** Days needed between the spray and the harvest (DAR). */
  preHarvestIntervalDays: z.number().int().nullable(),
  /** Allowed crop stages (BBCH). Not checked by the server. */
  bbchMin: z.number().int().nullable(),
  bbchMax: z.number().int().nullable(),
  /** Untreated buffer zone near water (ZNT), m. */
  bufferZoneWaterM: z.number().nullable(),
  conditions: z.string().nullable(),
  /** date + preHarvestIntervalDays <= expected harvest. Null when the use has no interval. */
  preHarvestOk: z.boolean().nullable(),
});
export type ProductUseRule = z.infer<typeof ProductUseRuleSchema>;

/** One past application of the product on the field this season. */
export const ProductApplicationSchema = z.object({
  date: IsoDateSchema,
  dose: z.number().nullable(),
  doseUnit: z.string().nullable(),
});
export type ProductApplication = z.infer<typeof ProductApplicationSchema>;

export const ProductCheckSchema = z.object({
  /** What the farmer asked for, as given. */
  query: z.string(),
  /** Day of the planned spray. */
  date: IsoDateSchema,
  fieldId: z.number().int(),
  fieldName: z.string(),
  /** The crop on the field on `date`, or null. */
  crop: z.object({
    seasonId: z.number().int(),
    code: z.string(),
    /** In the farm's language. */
    name: z.string(),
    sowingDate: IsoDateSchema,
    /** Expected harvest unless the crop is harvested. */
    harvestDate: IsoDateSchema,
  }).nullable(),
  /** found: one product; ambiguous: several match and there is no verdict; not_found: none. */
  status: z.enum(["found", "ambiguous", "not_found"]),
  /** The product, when found. */
  product: ProductMatchSchema.nullable(),
  /** The candidates when ambiguous (at most PRODUCT_MATCHES_MAX); empty otherwise. */
  matches: z.array(ProductMatchSchema),
  /**
   * True: E-Phy lists at least one use of the product on the crop; false: none (not authorised).
   * Null: no verdict (not exactly one product, no crop on the date, or no E-Phy data).
   */
  authorised: z.boolean().nullable(),
  /** E-Phy uses of the product on the crop. */
  uses: z.array(ProductUseRuleSchema),
  /**
   * From the farm journal: confirmed operations on this field during the crop season, up to
   * `date`, with the product. Null when no product was found or there is no crop.
   */
  usage: z.object({
    timesUsed: z.number().int(),
    lastDate: IsoDateSchema.nullable(),
    /** Newest first. */
    applications: z.array(ProductApplicationSchema),
  }).nullable(),
  /** maxApplications − timesUsed (never below 0), only when the crop has exactly one use. */
  applicationsLeft: z.number().int().nullable(),
  /** Expected harvest − date, days. Null without a crop. */
  daysToHarvest: z.number().int().nullable(),
  /** Every use with an interval agrees that date + interval <= harvest. Null otherwise. */
  preHarvestOk: z.boolean().nullable(),
  warnings: z.array(z.string()),
});
export type ProductCheck = z.infer<typeof ProductCheckSchema>;
