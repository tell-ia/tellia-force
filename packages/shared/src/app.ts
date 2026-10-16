import { z } from "zod";
import { IsoDateSchema } from "./irrigation";

// ---------------------------------------------------------------------------
// TelliaForce app view-models — the render-ready shapes the mobile UI consumes.
//
// A thin, screen-shaped projection of the engine contracts in ./irrigation
// (FieldReport, FarmAdvice, DayBalance…). Ids match the backend: a parcel id IS
// a `fieldId`, a farm id IS the backend farm id.
//
// `ParcelReport` is the contract the data endpoint `get_parcel_report` returns
// (see docs/parcel-report-contract.md). Each sub-object doubles as a widget's
// props; `widgetJsonSchemas()` exports them as JSON Schema for the chat agent's
// `show_widget` tool, so the LLM can only emit valid widgets.
// ---------------------------------------------------------------------------

/** Current ParcelReport contract version. Bump on a breaking shape change. */
export const PARCEL_REPORT_VERSION = "v0";

// --- Persona / farm ------------------------------------------------------

/** A farm the persona switch can select. Curated app config, not a raw DB row. */
export const FarmSummarySchema = z.object({
  id: z.number().int(), // backend farm id
  code: z.string(), // source_holding_id, e.g. "FARM-02580"
  name: z.string(),
  region: z.string(),
  initials: z.string(), // avatar, e.g. "OF"
  parcelCount: z.number().int(),
  featured: z.boolean(), // highlighted in the picker
  live: z.boolean(), // true = real data/chat; false = fixtures only
  farmerName: z.string(),
  memberId: z.number().int(), // x-member-id for live calls
});
export type FarmSummary = z.infer<typeof FarmSummarySchema>;

// --- Today -----------------------------------------------------------------

export const ParcelStatusSchema = z.enum(["action", "ok", "idle"]);
export type ParcelStatus = z.infer<typeof ParcelStatusSchema>;

/** One row of the Today list. */
export const ParcelSummarySchema = z.object({
  id: z.number().int(), // = backend fieldId
  name: z.string(),
  cropName: z.string(),
  areaHa: z.number(),
  stageLabel: z.string().nullable(),
  status: ParcelStatusSchema,
  badgeLabel: z.string(), // "Irrigate by Fri" / "OK · 3 more days"
  // present when status === "action":
  netMm: z.number().nullable(),
  reservePct: z.number().int().nullable(),
  thresholdLabel: z.string().nullable(),
});
export type ParcelSummary = z.infer<typeof ParcelSummarySchema>;

export const FarmTodaySchema = z.object({
  farmId: z.number().int(),
  asOf: IsoDateSchema,
  greeting: z.string(), // "Good morning, Claire. One field needs water."
  weatherNote: z.string(),
  parcels: z.array(ParcelSummarySchema),
  // Optional end-of-list weather/operations callout.
  alert: z.object({ title: z.string(), detail: z.string() }).nullable(),
});
export type FarmToday = z.infer<typeof FarmTodaySchema>;

// --- Parcel detail ---------------------------------------------------------

export const RecommendationSchema = z.object({
  decision: z.string(), // mirrors an irrigation Decision label
  headline: z.string(), // "Irrigate by Fri 15"
  netMm: z.number(),
  grossMm: z.number(),
  efficiency: z.number(), // 0.8 reel gun
  reason: z.string(),
  secondPass: z.string().nullable(),
});

export const ReserveSchema = z.object({
  availableMm: z.number(),
  capacityMm: z.number(),
  pct: z.number().int(),
  thresholdMm: z.number(),
  thresholdPct: z.number().int(),
  thresholdLabel: z.string(), // "Fri eve"
  usedByThresholdMm: z.number(), // hatched band
});

/** One day of the balance series (projection of DayBalance). */
export const BalancePointSchema = z.object({
  date: IsoDateSchema,
  dayLabel: z.string(), // "3", "13"
  rain: z.number(),
  irrigation: z.number(),
  cropUse: z.number(),
  reserveMm: z.number(),
  forecast: z.boolean(),
});

export const CropStageStepSchema = z.object({
  label: z.string(), // "Flowering"
  weight: z.number(), // flex weight on the timeline
  current: z.boolean(),
});

export const CropTimelineSchema = z.object({
  label: z.string(),
  daysSinceSowing: z.number().int(),
  gdd: z.number(),
  gddBase: z.number().int(),
  useTodayMm: z.number(),
  useTomorrowMm: z.number(),
  note: z.string(),
  progress: z.number(), // 0..1 marker position
  steps: z.array(CropStageStepSchema),
});
export type CropTimeline = z.infer<typeof CropTimelineSchema>;

export const SoilSchema = z.object({
  texture: z.string(),
  sandPct: z.number().int(),
  siltPct: z.number().int(),
  clayPct: z.number().int(),
  omPct: z.number(),
  usableMm: z.number(),
  rootDepthM: z.number(),
  note: z.string(),
});

export const SeasonBalanceSchema = z.object({
  rainMm: z.number(),
  irrigatedMm: z.number(),
  cropUseMm: z.number(),
  drainedMm: z.number(),
  stressDays: z.number().int(),
  cropDays: z.number().int(),
});

export const NextDaySchema = z.object({
  day: z.string(), // "Thu 14"
  tempMax: z.number().int(),
  pctNoWater: z.number().int(),
  pctWatered: z.number().int(),
});

/** Everything the parcel detail screen needs = the `get_parcel_report` contract. */
export const ParcelReportSchema = z.object({
  schemaVersion: z.literal(PARCEL_REPORT_VERSION), // consumers fall back on a mismatch
  id: z.number().int(), // fieldId
  farmId: z.number().int(),
  name: z.string(),
  cropName: z.string(),
  areaHa: z.number(),
  sownOn: IsoDateSchema.optional(),
  asOf: IsoDateSchema,
  // Core (always present): the recommendation + current reserve.
  recommendation: RecommendationSchema,
  reserve: ReserveSchema,
  // Rich sections — present in the full get_parcel_report, omitted by the
  // lightweight live path (from FieldReport) until that endpoint ships. The UI
  // renders each only when present.
  series: z.array(BalancePointSchema).optional(),
  cropStage: CropTimelineSchema.optional(),
  soil: SoilSchema.optional(),
  seasonBalance: SeasonBalanceSchema.optional(),
  nextDays: z.array(NextDaySchema).optional(),
  method: z.string(), // footnote
});
export type ParcelReport = z.infer<typeof ParcelReportSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type Reserve = z.infer<typeof ReserveSchema>;
export type BalancePoint = z.infer<typeof BalancePointSchema>;
export type CropStageStep = z.infer<typeof CropStageStepSchema>;
export type Soil = z.infer<typeof SoilSchema>;
export type SeasonBalance = z.infer<typeof SeasonBalanceSchema>;
export type NextDay = z.infer<typeof NextDaySchema>;

// --- Logging ---------------------------------------------------------------

export const IrrigationLogStatusSchema = z.enum(["planned", "done"]);
export const IrrigationLogSchema = z.object({
  id: z.number().int().nullable(),
  parcelId: z.number().int(), // fieldId
  date: IsoDateSchema,
  netMm: z.number(),
  grossMm: z.number().nullable(),
  status: IrrigationLogStatusSchema,
  source: z.string(), // "voice" | "app"
});
export type IrrigationLog = z.infer<typeof IrrigationLogSchema>;

// --- Chat (v0 text-only) ---------------------------------------------------

/** Phase 3 renders real AI SDK v7 tool parts; this is the dev-playground shape. */
export const ChatRoleSchema = z.enum(["assistant", "farmer"]);
export const ChatMessageSchema = z.object({
  id: z.string(),
  role: ChatRoleSchema,
  text: z.string(),
  at: z.string(), // "07:00"
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// --- Widgets: registry + JSON Schema (for the chat agent's show_widget tool) --

/** Each render-ready widget's props schema, keyed by widget name. */
export const widgetSchemas = {
  recommendation: RecommendationSchema,
  reserve: ReserveSchema,
  waterBalance: z.array(BalancePointSchema),
  cropStage: CropTimelineSchema,
  nextDays: z.array(NextDaySchema),
  seasonBalance: SeasonBalanceSchema,
  soil: SoilSchema,
  parcelReport: ParcelReportSchema,
} as const;
export type WidgetName = keyof typeof widgetSchemas;

/** JSON Schema for every widget — feed to the LLM's show_widget tool so it can
 *  only emit valid widget props (numbers come from the engine, never invented). */
export function widgetJsonSchemas(): Record<WidgetName, unknown> {
  return Object.fromEntries(
    Object.entries(widgetSchemas).map(([k, s]) => [k, z.toJSONSchema(s)]),
  ) as Record<WidgetName, unknown>;
}

/** Version-tolerant parse: unknown schemaVersion → null so the UI can fall back
 *  instead of throwing. */
export function parseParcelReport(data: unknown): ParcelReport | null {
  if (!data || typeof data !== "object") return null;
  if ((data as { schemaVersion?: unknown }).schemaVersion !== PARCEL_REPORT_VERSION) return null;
  const r = ParcelReportSchema.safeParse(data);
  return r.success ? r.data : null;
}
