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
  grossMm: z.number().nullable().optional(), // what to pump at the gun
  reservePct: z.number().int().nullable(),
  thresholdLabel: z.string().nullable(),
  /** Big-deficit fields: "then ~N more passes to refill". */
  refillNote: z.string().nullable().optional(),
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

/** The engine-computed refill plan: each pass + the resulting reserve curve. */
export const RefillPassSchema = z.object({
  date: IsoDateSchema,
  grossMm: z.number(),
});
export const RefillPlanSchema = z.object({
  series: z.array(BalancePointSchema),
  passes: z.array(RefillPassSchema),
});
export type RefillPlanSeries = z.infer<typeof RefillPlanSchema>;

export const CropStageStepSchema = z.object({
  label: z.string(), // "Flowering"
  weight: z.number(), // flex weight on the timeline
  current: z.boolean(),
  startDate: IsoDateSchema.nullable().optional(), // when this stage starts (degree-day driven)
  forecast: z.boolean().optional(), // true when that date is still ahead (projected)
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
  tempMax: z.number().int().optional(), // omitted when the series carries no temperature
  pctNoWater: z.number().int(),
  pctRain: z.number().int().optional(), // part of pctNoWater that fell as rain that day (rest = soil)
  rainMm: z.number().optional(), // that day's forecast rain
  pctWatered: z.number().int(),
  pctIrrigation: z.number().int().optional(), // net water the plan adds that day (% of the reserve)
  waterMm: z.number().optional(), // gross mm pumped that day by the plan (watering days only)
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
  /** Multi-pass refill plan (engine-simulated), when the field needs several passes. */
  plan: RefillPlanSchema.optional(),
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

// --- Chat sessions (threads) -----------------------------------------------
// One Mastra thread per conversation. The app picks the thread with this request header on
// POST /chat, GET /chat/history and GET /chat/threads. A thread id always starts with its
// member's prefix, so the server can refuse another member's id without a lookup.

export const CHAT_THREAD_HEADER = "x-thread-id";

/** `member-<memberId>-`: every thread id of that member starts with it. */
export const memberThreadPrefix = (memberId: number): string => `member-${memberId}-`;

/** A fresh thread id: the member prefix plus a random UUID (made on the client). */
export const newThreadId = (memberId: number, uuid: string): string => `${memberThreadPrefix(memberId)}${uuid}`;

/** Prefix, then letters, digits and dashes only (covers UUIDs and the old `member-1-2026-07-05` ids). */
export const isThreadIdOfMember = (threadId: string, memberId: number): boolean =>
  threadId.startsWith(memberThreadPrefix(memberId)) &&
  /^[A-Za-z0-9-]{1,64}$/.test(threadId.slice(memberThreadPrefix(memberId).length));

/** One past conversation. `title` is the generated one, `null` until there is one. */
export const ChatThreadSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable(),
  createdAt: z.string(), // ISO timestamp
  updatedAt: z.string(), // ISO timestamp
});
export type ChatThreadSummary = z.infer<typeof ChatThreadSummarySchema>;

/** GET /chat/threads: the caller's threads, most recently updated first. */
export const ChatThreadListSchema = z.array(ChatThreadSummarySchema);
export type ChatThreadList = z.infer<typeof ChatThreadListSchema>;

/** POST /chat/threads/:threadId/truncate: edit a sent message. The server removes that message and
 *  every later one from the thread's memory, so the resent text starts from there. */
export const TruncateChatThreadBodySchema = z.object({
  fromMessageId: z.string().min(1),
});
export type TruncateChatThreadBody = z.infer<typeof TruncateChatThreadBodySchema>;

export const TruncateChatThreadResultSchema = z.object({
  threadId: z.string().min(1),
  /** Messages removed from memory (the edited one included). */
  removed: z.number().int().nonnegative(),
  /** Unanswered irrigation confirmations in the removed messages, cancelled like a "No". */
  cancelledRuns: z.number().int().nonnegative(),
});
export type TruncateChatThreadResult = z.infer<typeof TruncateChatThreadResultSchema>;

// --- Member phone (VAPI persona hack) --------------------------------------

/** Set a member's phone when a persona is selected, so the single VAPI number
 *  routes a call/SMS back to the right person + farm. */
export const SetMemberPhoneBodySchema = z.object({
  phone: z.string().trim().min(3).max(24),
});
export type SetMemberPhoneBody = z.infer<typeof SetMemberPhoneBodySchema>;

export const MemberPhoneSchema = z.object({
  id: z.number().int(),
  phone: z.string().nullable(),
});
export type MemberPhone = z.infer<typeof MemberPhoneSchema>;

/** POST /notify/brief-sms: today's brief (the Today screen's advice) sent by SMS through VAPI. */
export const SendBriefSmsBodySchema = z.object({
  phone: z.string().trim().min(3).max(24),
});
export type SendBriefSmsBody = z.infer<typeof SendBriefSmsBodySchema>;

export const BriefSmsSchema = z.object({
  to: z.string(),
  text: z.string(),
});
export type BriefSms = z.infer<typeof BriefSmsSchema>;

// --- Demo date -----------------------------------------------------------

/** First day with weather in the DB: the earliest demo date. */
export const DEMO_DATE_MIN = "2015-01-01";

/**
 * The project's "today" (GET/PUT /settings/date). One date for everyone: app, chat, calls, SMS.
 * `today` = `demoDate` when set, else the server default (DEMO_DATE env or the real date).
 */
export const DemoDateStateSchema = z.object({
  today: IsoDateSchema,
  realToday: IsoDateSchema,
  demoDate: IsoDateSchema.nullable(),
  min: IsoDateSchema,
  max: IsoDateSchema,
});
export type DemoDateState = z.infer<typeof DemoDateStateSchema>;

/** `date: null` goes back to the server default. */
export const SetDemoDateBodySchema = z.object({ date: IsoDateSchema.nullable() });
export type SetDemoDateBody = z.infer<typeof SetDemoDateBodySchema>;

// --- Voice input -----------------------------------------------------------

/**
 * POST /voice/session: a short-lived OpenAI Realtime key, scoped to one transcription session.
 * The app opens WebRTC to OpenAI with it; the real OPENAI_API_KEY never leaves the server.
 */
export const VoiceSessionSchema = z.object({
  clientSecret: z.string().min(1), // "ek_…"
  expiresAt: z.number().int(), // epoch seconds
  model: z.string().min(1),
});
export type VoiceSession = z.infer<typeof VoiceSessionSchema>;

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

// --- Cross-field irrigation plan (reel-gun rotation) ----------------------
//
// A field is covered by several reel RUNS (strips). Each gun does one run at a time,
// so runs across fields are sequenced on each gun's timeline: move (setup + tow),
// then run for its hours. A run is `late` when its gun was still busy when the field
// needed water; `bumped` marks an earlier run whose dose was raised (within the soil
// cap) so the field holds until the gun comes back. Times are hours from `asOf` 00:00.

export const FarmPlanRunSchema = z.object({
  fieldId: z.number().int(),
  fieldName: z.string(),
  gunIndex: z.number().int(), // which reel gun runs it
  runIndex: z.number().int(), // run number within the field's pass
  passIndex: z.number().int(), // 0 = first watering of the field, 1 = next…
  startHour: z.number(),
  endHour: z.number(),
  neededHour: z.number(), // when the field needed water (engine trigger)
  grossMm: z.number(),
  netMm: z.number(),
  areaHa: z.number(), // the run's share of the field
  late: z.boolean(),
  bumped: z.boolean(),
  note: z.string().nullable(),
});
export type FarmPlanRun = z.infer<typeof FarmPlanRunSchema>;

export const FarmPlanGunSchema = z.object({
  id: z.string(),
  name: z.string(),
  flowM3h: z.number(),
  stripWidthM: z.number(),
});
export type FarmPlanGun = z.infer<typeof FarmPlanGunSchema>;

// The consequence of the plan on one field: its forecast re-simulated with the
// ACTUAL watering dates the rotation gives it (so the reserve dips when a pass runs
// late), plus what the gun does for it today.
export const FarmFieldOutcomeSchema = z.object({
  fieldId: z.number().int(),
  fieldName: z.string(),
  late: z.boolean(),
  todayGross: z.number().nullable(), // mm the gun applies here today (null = nothing today)
  todayGunIndex: z.number().int().nullable(),
  todayStartHour: z.number().nullable(), // hour-of-day the gun starts here today (null = nothing today)
  comfortDay: z.number().int().nullable(), // projected days from asOf until back above comfort (0 = already, null = never at this gun count)
  gapMm: z.array(z.number()).optional(), // per grid day: projected mm still below comfort at the end of that day (0 = back to comfort)
  nextDate: IsoDateSchema.nullable(), // next watering day in the plan
  series: z.array(BalancePointSchema), // reserve re-simulated on the plan's real dates
});
export type FarmFieldOutcome = z.infer<typeof FarmFieldOutcomeSchema>;

export const FarmIrrigationPlanSchema = z.object({
  farmId: z.number().int(),
  asOf: IsoDateSchema,
  horizonDays: z.number().int(),
  guns: z.array(FarmPlanGunSchema),
  pumpM3h: z.number(),
  moveMinutes: z.number(),
  runs: z.array(FarmPlanRunSchema),
  fields: z.array(FarmFieldOutcomeSchema),
  feasible: z.boolean(), // every field stays above its comfort line
  suggestedGuns: z.number().int(), // guns to run a steady rotation without over-buying
  comfortInDays: z.number().int().nullable(), // days until every field is back above comfort (null = not within the forecast window)
  cyclesToComfort: z.number().int().nullable(), // rotation rounds to get there
  warnings: z.array(z.string()),
  totalHours: z.number(),
});
export type FarmIrrigationPlan = z.infer<typeof FarmIrrigationPlanSchema>;
