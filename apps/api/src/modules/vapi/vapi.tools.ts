// The phone assistant's tools. VAPI sends their calls to POST /vapi/tools, and
// scripts/vapiSetup.ts registers the same names, descriptions and parameters on VAPI.
// Results are short: the voice model reads all of them, and every number comes from the engine.

import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { type FieldReport, IsoDateSchema, ScenarioEventSchema } from "@tellia/shared/irrigation";
import type { FarmScope } from "../irrigation/farmRegistry";

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
};

const SAFE_INT_BOUNDS = new Set([Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]);

/** JSON Schema for VAPI: no `$schema`, no `additionalProperties`, no safe-integer bounds. */
function cleanSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(cleanSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "$schema" || k === "additionalProperties") continue;
    if ((k === "minimum" || k === "maximum") && SAFE_INT_BOUNDS.has(v as number)) continue;
    out[k] = cleanSchema(v);
  }
  return out;
}

/** The function definitions VAPI needs, one per tool (OpenAI function format). */
export function vapiFunctions() {
  return Object.entries(VAPI_TOOLS).map(([name, t]) => ({
    name,
    description: t.description,
    parameters: cleanSchema(z.toJSONSchema(t.parameters, { io: "input" })) as Record<
      string,
      unknown
    >,
  }));
}
