// The phone assistant's tools. VAPI sends their calls to POST /vapi/tools, and
// scripts/vapiSetup.ts registers the same names, descriptions and parameters on VAPI.
// Results are short: the voice model reads all of them, and every number comes from the engine.

import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { type FieldReport, IsoDateSchema, ScenarioEventSchema } from "@tellia/shared/irrigation";
import {
  CorrectionActionSchema,
  type JournalEntry,
  JournalTypeSchema,
  type ProductUseRule,
} from "@tellia/shared/farm";
import type { FarmScope } from "../irrigation/farmRegistry";
import { bbchRange } from "../irrigation/productCheck.service";

export interface VapiCaller {
  memberId: number;
  scope: FarmScope;
  /** False when the phone number is not a member's: read-only access to the default farm. */
  known: boolean;
}

export interface VapiTool {
  description: string;
  parameters: z.ZodType;
  /** Validates the raw arguments, then runs. Throws ZodError or HTTPException. */
  run(args: unknown, caller: VapiCaller): Promise<object>;
}

function defineTool<S extends z.ZodType>(t: {
  description: string;
  parameters: S;
  run(args: z.output<S>, caller: VapiCaller): Promise<object>;
}): VapiTool {
  return {
    description: t.description,
    parameters: t.parameters,
    run: (args, caller) => t.run(t.parameters.parse(args), caller),
  };
}

/** What the voice needs from a field report. */
function brief(r: FieldReport) {
  return {
    fieldId: r.fieldId,
    fieldName: r.fieldName,
    cropName: r.cropName,
    stage: r.stageLabel,
    decision: r.decision,
    irrigateMm: r.irrigateMm,
    depletionPct: r.depletionPct,
    daysUntilIrrigation: r.daysUntilIrrigation,
    rainNext3DaysMm: r.rainNext3DaysMm,
    reason: r.reason,
    warnings: r.warnings,
  };
}

/** The voice reads every entry: fewer than the chat's 20. */
export const VOICE_JOURNAL_ENTRIES = 10;

/** One journal entry, flat: products as short strings ("ELUMIS 1.25 L/ha"). */
function voiceEntry(e: JournalEntry) {
  const { operationId: _id, fieldId: _f, status: _s, bbch: _b, products, ...rest } = e;
  return {
    ...rest,
    ...(products.length
      ? {
        products: products.map((p) =>
          [p.productName, p.dose, p.doseUnit].filter((x) => x != null).join(" ")
        ),
      }
      : {}),
  };
}

/**
 * One E-Phy use as a short string: "Pyrale(s): max 0.2 L/ha, 2 applications, 7 days before
 * harvest, 50 m from water". Conditions are left out (too long to read aloud).
 */
function voiceUse(u: ProductUseRule): string {
  const parts = [
    u.maxDose != null ? `max ${[u.maxDose, u.doseUnit].filter((x) => x != null).join(" ")}` : null,
    u.maxApplications != null
      ? `${u.maxApplications} application${u.maxApplications === 1 ? "" : "s"}`
      : null,
    u.preHarvestIntervalDays != null ? `${u.preHarvestIntervalDays} days before harvest` : null,
    u.bbchMin != null || u.bbchMax != null ? bbchRange(u.bbchMin, u.bbchMax) : null,
    u.bufferZoneWaterM != null ? `${u.bufferZoneWaterM} m from water` : null,
  ].filter((x) => x != null);
  return `${u.target ?? "any target"}: ${parts.join(", ") || "no limits given"}`;
}

const date = IsoDateSchema.optional().describe("Day to evaluate, YYYY-MM-DD. Default: today.");
const fieldId = z.number().int().describe("Field id, from resolve_field.");

/** One what-if event, flat so the voice model fills it easily; checked by ScenarioEventSchema. */
const VoiceEventSchema = z.object({
  type: z.enum(["irrigation", "rain", "drought", "flood", "frost", "hail"]),
  date: IsoDateSchema.describe("Day the event happens or starts, YYYY-MM-DD."),
  mm: z.number().positive().optional().describe("Water in mm: irrigation, rain or flood."),
  days: z.number().int().min(1).max(30).optional().describe("Length in days: drought."),
  tmin: z.number().max(0).optional().describe("Lowest temperature in °C: frost."),
});

export const VAPI_TOOLS: Record<string, VapiTool> = {
  resolve_field: defineTool({
    description:
      "Find the farmer's fields by name or crop from what they said (e.g. 'the valley', 'maize'). Best matches first. Call it before any tool that needs a fieldId.",
    parameters: z.object({ query: z.string().min(1) }),
    run: async ({ query }, { scope }) => ({ matches: await scope.service.resolveField(query) }),
  }),

  get_farm_advice: defineTool({
    description:
      "Irrigation advice for every field of the farm, most urgent first. Use it for 'what should I water today' or any whole-farm question.",
    parameters: z.object({ date }),
    run: async ({ date }, { scope }) => {
      const advice = await scope.service.getFarmAdvice(date);
      return { asOf: advice.asOf, fields: advice.reports.map(brief) };
    },
  }),

  get_field_report: defineTool({
    description:
      "Irrigation advice for one field: decision, mm to apply, how dry the root zone is (depletionPct), rain forecast and the reason.",
    parameters: z.object({ fieldId, date }),
    run: async ({ fieldId, date }, { scope }) => {
      const report = await scope.service.getFieldReport(fieldId, date);
      return { asOf: report.asOf, ...brief(report) };
    },
  }),

  get_weather: defineTool({
    description:
      "Daily weather for a field, 3 days before to 3 days after a date: rain (mm), temperatures (°C) and evapotranspiration (et0, mm). Use it for questions about rain or frost.",
    parameters: z.object({ fieldId, date }),
    run: async ({ fieldId, date }, { scope }) => ({
      fieldId,
      days: (await scope.service.getWeather(fieldId, date)).map(({ source: _s, ...d }) => d),
    }),
  }),

  get_irrigation_history: defineTool({
    description:
      "Irrigations recorded on a field, newest first, optionally between two dates. Use it for 'when did I last water' or 'how much did I water this month'.",
    parameters: z.object({
      fieldId,
      from: IsoDateSchema.optional().describe("First day, YYYY-MM-DD."),
      to: IsoDateSchema.optional().describe("Last day, YYYY-MM-DD."),
    }),
    run: async ({ fieldId, from, to }, { scope }) => ({
      fieldId,
      records: await scope.service.listIrrigations(fieldId, { from, to }),
    }),
  }),

  simulate_scenario: defineTool({
    description:
      "What-if on one field: apply events (irrigation, rain, drought, flood, frost, hail) and compare the advice with and without them. Nothing is saved.",
    parameters: z.object({
      fieldId,
      events: z.array(VoiceEventSchema).min(1).max(10),
      date,
    }),
    run: async ({ fieldId, events, date }, { scope }) => {
      const result = await scope.service.simulateScenario(
        fieldId,
        z.array(ScenarioEventSchema).parse(events),
        date,
      );
      return {
        asOf: result.asOf,
        comparison: result.comparison,
        before: brief(result.baseline),
        after: brief(result.scenario),
      };
    },
  }),

  get_field_details: defineTool({
    description:
      "Facts about one field: size, the crop growing today (variety, sowing and harvest dates, previous crop), its irrigation system and its latest soil analysis (texture, pH, organic matter, nitrogen, phosphorus, potassium).",
    parameters: z.object({ fieldId }),
    run: async ({ fieldId }, { scope }) => {
      const { field, crop, irrigationSystem: system, soil } = await scope.service.getFieldDetails(
        fieldId,
      );
      return {
        fieldId: field.id,
        fieldName: field.name,
        areaHa: field.areaHa,
        tenure: field.tenure,
        irrigable: field.irrigable,
        cropName: crop?.name ?? null,
        variety: crop?.variety ?? null,
        sowingDate: crop?.sowingDate ?? null,
        harvestDate: crop?.harvestDate ?? null,
        cropStatus: crop?.status ?? null,
        previousCrop: crop?.previousCropName ?? null,
        irrigationSystem: system?.name ?? null,
        irrigationSystemType: system?.type ?? null,
        soilSampledOn: soil?.sampledOn ?? null,
        soilTexture: soil?.textureClass ?? null,
        ph: soil?.ph ?? null,
        organicMatterPct: soil?.organicMatterPct ?? null,
        sandPct: soil?.sandPct ?? null,
        siltPct: soil?.siltPct ?? null,
        clayPct: soil?.clayPct ?? null,
        nitrogenGKg: soil?.nitrogenGKg ?? null,
        phosphorusMgKg: soil?.phosphorusMgKg ?? null,
        potassiumMgKg: soil?.potassiumMgKg ?? null,
        limeRequirementTHa: soil?.limeRequirementTHa ?? null,
      };
    },
  }),

  get_field_journal: defineTool({
    description:
      "What was done on a field, or on every field: sowing, fertiliser, sprays and their products, irrigation, harvest. Newest first, with totals for the whole period (nitrogen, phosphorus and potassium in kg per hectare, irrigation mm, number of sprays). Entries with planned true are not done yet. Default period: the field's crop season, or the last year for the whole farm.",
    parameters: z.object({
      fieldId: z.number().int().optional().describe(
        "Field id, from resolve_field. Leave it out for the whole farm.",
      ),
      type: JournalTypeSchema.optional().describe("Only this kind of work."),
      from: IsoDateSchema.optional().describe("First day, YYYY-MM-DD."),
      to: IsoDateSchema.optional().describe("Last day, YYYY-MM-DD."),
    }),
    run: async ({ fieldId, type, from, to }, { scope }) => {
      const j = await scope.service.getFieldJournal({ fieldId, type, from, to });
      const entries = j.entries.slice(0, VOICE_JOURNAL_ENTRIES).map(voiceEntry);
      return {
        fieldName: j.fieldName,
        from: j.from,
        to: j.to,
        entries,
        totals: j.totals,
        truncated: j.truncated || j.entries.length > entries.length,
      };
    },
  }),

  check_product_use: defineTool({
    description:
      "Check a crop protection product for a field's crop on a day: is it authorised (French E-Phy register), how many times it was used this season, how many applications are left, the days to harvest and whether the pre-harvest interval is met. If several products match, ask which one. The crop stage is not checked. Say every warning and never invent a rule.",
    parameters: z.object({
      product: z.string().min(1).describe("Product name or AMM number, as the farmer said it."),
      fieldId,
      date: IsoDateSchema.optional().describe(
        "Day of the planned spray, YYYY-MM-DD. Default: today.",
      ),
    }),
    run: async ({ product, fieldId, date }, { scope }) => {
      const c = await scope.service.checkProductUse({ product, fieldId, date });
      return {
        status: c.status,
        product: c.product?.name ?? null,
        matches: c.matches.map((m) => m.name),
        fieldName: c.fieldName,
        cropName: c.crop?.name ?? null,
        date: c.date,
        authorised: c.authorised,
        uses: c.uses.map(voiceUse),
        timesUsed: c.usage?.timesUsed ?? null,
        lastUsed: c.usage?.lastDate ?? null,
        applicationsLeft: c.applicationsLeft,
        daysToHarvest: c.daysToHarvest,
        preHarvestOk: c.preHarvestOk,
        warnings: c.warnings,
      };
    },
  }),

  record_irrigation: defineTool({
    description:
      "Save an irrigation the farmer did. Only call it after you read back the field, date and mm and the farmer clearly said yes.",
    parameters: z.object({
      fieldId,
      date: IsoDateSchema.describe("Day the irrigation happened, YYYY-MM-DD. Not in the future."),
      mm: z.number().positive().max(200).describe("Water applied, in mm."),
    }),
    run: async ({ fieldId, date, mm }, { scope, memberId, known }) => {
      if (!known) {
        throw new HTTPException(403, {
          message: "this phone number is not a farm member, so it cannot record irrigations",
        });
      }
      const record = await scope.service.recordIrrigation({
        fieldId,
        date,
        mm,
        memberId,
        source: "phone_call",
      });
      return { saved: true, record };
    },
  }),

  correct_irrigation: defineTool({
    description:
      "Change the day or the millimetres of an irrigation already recorded, or delete it. Find it with get_irrigation_history (its operationId). Only call it after you read back the change and the farmer clearly said yes.",
    parameters: z.object({
      operationId: z.number().int().describe(
        "operationId of the irrigation, from get_irrigation_history.",
      ),
      action: CorrectionActionSchema.describe(
        "update: change its day and/or millimetres; delete: remove it.",
      ),
      date: IsoDateSchema.optional().describe(
        "update only: the right day, YYYY-MM-DD. Leave it out to keep the day.",
      ),
      mm: z.number().positive().max(200).optional().describe(
        "update only: the right water applied, in mm. Leave it out to keep the mm.",
      ),
    }),
    run: async ({ operationId, action, date, mm }, { scope, known }) => {
      if (!known) {
        throw new HTTPException(403, {
          message: "this phone number is not a farm member, so it cannot change irrigations",
        });
      }
      const { fieldName, before } = await scope.service.previewIrrigationCorrection({
        operationId,
        action,
        date,
        mm,
      });
      if (action === "delete") {
        await scope.service.deleteIrrigation(operationId);
        return { status: "deleted", fieldName, date: before.date, mm: before.mm };
      }
      const record = await scope.service.updateIrrigation(operationId, { date, mm });
      return {
        status: "updated",
        fieldName,
        oldDate: before.date,
        oldMm: before.mm,
        newDate: record.date,
        newMm: record.mm,
      };
    },
  }),
};

/** JSON Schema keywords sent to VAPI. Bounds stay out: the webhook re-validates with zod. */
const KEEP = new Set(["type", "properties", "items", "required", "description", "enum", "pattern"]);

function cleanSchema(node: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (!KEEP.has(k)) continue;
    if (k === "properties") {
      const props = Object.entries(v as Record<string, Record<string, unknown>>);
      out[k] = Object.fromEntries(props.map(([name, schema]) => [name, cleanSchema(schema)]));
    } else if (k === "items") out[k] = cleanSchema(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

/** The function definitions VAPI needs, one per tool (OpenAI function format). */
export function vapiFunctions() {
  return Object.entries(VAPI_TOOLS).map(([name, t]) => ({
    name,
    description: t.description,
    parameters: cleanSchema(z.toJSONSchema(t.parameters, { io: "input" })),
  }));
}
