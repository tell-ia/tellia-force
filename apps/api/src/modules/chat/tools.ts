// The chat tools. The member and their farm come only from the request context, never from
// input, so a tool can only see and write the caller's own farm.

import { createTool } from "@mastra/core/tools";
import type { RequestContext } from "@mastra/core/request-context";
import { z } from "zod";
import {
  FarmAdviceSchema,
  FieldReportSchema,
  IrrigationRecordSchema,
  IsoDateSchema,
  ScenarioEventSchema,
  ScenarioResultSchema,
  WeatherDaySchema,
} from "@tellia/shared/irrigation";
import {
  CorrectionActionSchema,
  FarmLookupQuerySchema,
  FarmLookupSchema,
  FieldDetailsSchema,
  FieldJournalSchema,
  IrrigationConfirmationSchema,
  IrrigationCorrectionSchema,
  JournalTypeSchema,
  LOOKUP_DEFAULT_ROWS,
  LOOKUP_MAX_ROWS,
  LookupTableSchema,
  ProductCheckSchema,
} from "@tellia/shared/farm";
import type { FarmRegistry } from "../irrigation/farmRegistry";
import { FARM_ID_KEY, MEMBER_ID_KEY } from "./requestContext";

/** Workflows that wait for the farmer's yes/no (confirmIrrigation), and the step that waits. */
const CONFIRMABLE = [
  { workflowId: "record-irrigation", step: "confirm" },
  { workflowId: "correct-irrigation", step: "confirm-correction" },
] as const;

/** The calling member's id from the request context; throws when absent. */
export function memberIdFrom(ctx: { requestContext?: RequestContext<any> }): number {
  const id = ctx.requestContext?.get(MEMBER_ID_KEY);
  if (typeof id !== "number" || !Number.isInteger(id)) {
    throw new Error("no member in the request context");
  }
  return id;
}

/** The calling member's farm id from the request context; throws when absent. */
export function farmIdFrom(ctx: { requestContext?: RequestContext<any> }): number {
  const id = ctx.requestContext?.get(FARM_ID_KEY);
  if (typeof id !== "number" || !Number.isInteger(id)) {
    throw new Error("no farm in the request context");
  }
  return id;
}

// deno-lint-ignore no-explicit-any
type ToolCtx = { mastra?: any; requestContext: RequestContext<any> };

/** Runs a workflow to completion; anything but success becomes a thrown error. */
async function runWorkflow(
  ctx: ToolCtx,
  id: string,
  inputData: unknown,
) {
  if (!ctx.mastra) throw new Error("Mastra is not available to this tool");
  const run = await ctx.mastra.getWorkflow(id).createRun();
  const result = await run.start({ inputData, requestContext: ctx.requestContext });
  if (result.status !== "success") throw new Error(failureMessage(result));
  return result.result;
}

// deno-lint-ignore no-explicit-any
function failureMessage(result: any): string {
  const err = result.error?.message ?? result.error;
  if (err) return String(err);
  for (const step of Object.values(result.steps ?? {}) as { error?: { message?: string } }[]) {
    if (step?.error) return String(step.error.message ?? step.error);
  }
  return `workflow ${result.status}`;
}

export function createAdvisorTools(registry: FarmRegistry) {
  /** The caller's farm service; also checks the member is set. */
  const serviceOf = async (ctx: { requestContext?: RequestContext<any> }) => {
    memberIdFrom(ctx);
    return (await registry.forFarm(farmIdFrom(ctx))).service;
  };

  const date = IsoDateSchema.optional().describe("Day to evaluate, YYYY-MM-DD. Default: today.");
  const fieldId = z.number().int().describe("Field id, from resolveField.");

  const resolveField = createTool({
    id: "resolve_field",
    description:
      "Find fields by name or crop from what the farmer said (e.g. 'la vallée', 'maïs'). Returns the best matches first. Call it before any tool that needs a fieldId.",
    inputSchema: z.object({ query: z.string().min(1) }),
    outputSchema: z.object({
      matches: z.array(
        z.object({
          fieldId: z.number().int(),
          name: z.string(),
          cropName: z.string().nullable(),
        }),
      ),
    }),
    execute: async ({ query }, ctx) => {
      return { matches: await (await serviceOf(ctx)).resolveField(query) };
    },
  });

  const getFieldReport = createTool({
    id: "get_field_report",
    description:
      "Irrigation advice for one field: decision, mm to pump (irrigateGrossMm: the number to tell the farmer; irrigateMm is the net water that reaches the roots), the date to irrigate by, root-zone depletion, rain forecast and the reason. All numbers come from the calculation; never compute your own.",
    inputSchema: z.object({ fieldId, date }),
    outputSchema: FieldReportSchema,
    execute: async ({ fieldId, date }, ctx) => (await serviceOf(ctx)).getFieldReport(fieldId, date),
  });

  const widgetName = z.enum([
    "waterBalance",
    "reserve",
    "cropStage",
    "nextDays",
    "seasonBalance",
    "soil",
  ]);
  const showWidget = createTool({
    id: "show_widget",
    description:
      "Show one chart from a field's report in the chat when the farmer asks to SEE it: " +
      "`waterBalance` (the soil-water curve with rain/irrigation and the plan), `reserve` (the " +
      "soil-water reserve gauge), `cropStage` (the growth-stage timeline), `nextDays` (the 5-day " +
      "forecast), `seasonBalance` (season totals), `soil` (texture and usable water). Pick the one " +
      "they asked for; the app draws it, as of the current date, from the same field report the " +
      "parcel screen uses.",
    inputSchema: z.object({ fieldId, widget: widgetName }),
    outputSchema: z.object({ fieldId: z.number().int(), widget: widgetName }),
    execute: ({ fieldId, widget }) => Promise.resolve({ fieldId, widget }),
  });

  const getWeather = createTool({
    id: "get_weather",
    description:
      "Daily weather around a date for a field (evapotranspiration, rain, temperatures): 3 days before to 3 days after. Use it for questions about rain or temperatures.",
    inputSchema: z.object({ fieldId, date }),
    outputSchema: z.object({ fieldId: z.number().int(), days: z.array(WeatherDaySchema) }),
    execute: async ({ fieldId, date }, ctx) => {
      return { fieldId, days: await (await serviceOf(ctx)).getWeather(fieldId, date) };
    },
  });

  const getIrrigationHistory = createTool({
    id: "get_irrigation_history",
    description:
      "Confirmed irrigations recorded on a field, newest first, optionally between two dates. Use it for questions like 'when did I last water' or 'how much did I water this month'.",
    inputSchema: z.object({
      fieldId,
      from: IsoDateSchema.optional().describe("First day, YYYY-MM-DD."),
      to: IsoDateSchema.optional().describe("Last day, YYYY-MM-DD."),
    }),
    outputSchema: z.object({
      fieldId: z.number().int(),
      records: z.array(IrrigationRecordSchema),
    }),
    execute: async ({ fieldId, from, to }, ctx) => {
      const service = await serviceOf(ctx);
      return { fieldId, records: await service.listIrrigations(fieldId, { from, to }) };
    },
  });

  const getFarmAdvice = createTool({
    id: "get_farm_advice",
    description:
      "Ranked irrigation advice for every field of the farm, most urgent first. Use it for 'what should I water today' or any whole-farm question.",
    inputSchema: z.object({ date }),
    outputSchema: FarmAdviceSchema,
    execute: async ({ date }, ctx) => {
      memberIdFrom(ctx);
      return FarmAdviceSchema.parse(
        await runWorkflow(ctx, "farm-advice", { farmId: farmIdFrom(ctx), asOf: date }),
      );
    },
  });

  const simulateScenario = createTool({
    id: "simulate_scenario",
    description:
      "What-if on one field: apply events (irrigation, rain, drought, flood, frost, hail) to the water balance and compare with the baseline advice. Nothing is saved.",
    inputSchema: z.object({
      fieldId,
      events: z.array(ScenarioEventSchema).min(1).max(10),
      date,
    }),
    outputSchema: ScenarioResultSchema,
    execute: async ({ fieldId, events, date }, ctx) => {
      memberIdFrom(ctx);
      return ScenarioResultSchema.parse(
        await runWorkflow(ctx, "simulate-scenario", {
          farmId: farmIdFrom(ctx),
          fieldId,
          events,
          asOf: date,
        }),
      );
    },
  });

  const RecordOutput = z.object({
    runId: z.string(),
    status: z.literal("awaiting_confirmation"),
    summary: z.string(),
    fieldName: z.string(),
    date: IsoDateSchema,
    mm: z.number(),
  });
  const recordIrrigation = createTool({
    id: "record_irrigation",
    description:
      "Start recording an irrigation the farmer says they did. Nothing is saved yet: it returns a summary; ask the farmer this summary as a yes/no question, then call confirmIrrigation with their answer.",
    inputSchema: z.object({
      fieldId,
      date: IsoDateSchema.describe("Day the irrigation happened, YYYY-MM-DD."),
      mm: z.number().positive().max(200).describe("Water applied, in mm."),
    }),
    outputSchema: RecordOutput,
    execute: async ({ fieldId, date, mm }, ctx) => {
      const memberId = memberIdFrom(ctx);
      if (!ctx.mastra) throw new Error("Mastra is not available to this tool");
      const run = await ctx.mastra.getWorkflow("record-irrigation").createRun();
      const result = await run.start({
        inputData: { farmId: farmIdFrom(ctx), memberId, fieldId, date, mm },
        requestContext: ctx.requestContext,
      });
      if (result.status !== "suspended") throw new Error(failureMessage(result));
      const p = result.suspendPayload?.confirm ?? result.suspendPayload;
      return RecordOutput.parse({
        runId: run.runId,
        status: "awaiting_confirmation",
        summary: p.summary,
        fieldName: p.fieldName,
        date: p.date,
        mm: p.mm,
      });
    },
  });

  const correctIrrigation = createTool({
    id: "correct_irrigation",
    description:
      "Change the day or the mm of an irrigation already recorded, or delete it, when the farmer says it was wrong. Find its operationId with getIrrigationHistory first. Nothing changes yet: it returns a summary; ask the farmer this summary as a yes/no question, then call confirmIrrigation with their answer.",
    inputSchema: z.object({
      operationId: z.number().int().describe(
        "operationId of the irrigation to correct, from getIrrigationHistory.",
      ),
      action: CorrectionActionSchema.describe(
        "update: change its day and/or mm; delete: remove it.",
      ),
      date: IsoDateSchema.optional().describe(
        "update only: the right day, YYYY-MM-DD. Leave it out to keep the day.",
      ),
      mm: z.number().positive().max(200).optional().describe(
        "update only: the right water applied, in mm. Leave it out to keep the mm.",
      ),
    }),
    outputSchema: IrrigationCorrectionSchema,
    execute: async ({ operationId, action, date, mm }, ctx) => {
      const memberId = memberIdFrom(ctx);
      if (!ctx.mastra) throw new Error("Mastra is not available to this tool");
      const run = await ctx.mastra.getWorkflow("correct-irrigation").createRun();
      const result = await run.start({
        inputData: { farmId: farmIdFrom(ctx), memberId, operationId, action, date, mm },
        requestContext: ctx.requestContext,
      });
      if (result.status !== "suspended") throw new Error(failureMessage(result));
      const p = result.suspendPayload?.["confirm-correction"] ?? result.suspendPayload;
      return IrrigationCorrectionSchema.parse({
        runId: run.runId,
        status: "awaiting_confirmation",
        summary: p.summary,
        fieldName: p.fieldName,
        action: p.action,
        before: p.before,
        after: p.after,
      });
    },
  });

  const confirmIrrigation = createTool({
    id: "confirm_irrigation",
    description:
      "Finish a recordIrrigation or correctIrrigation run, only with the farmer's explicit answer to its yes/no question. confirmed true: saves the new irrigation (status saved) or applies the correction (updated or deleted); false: changes nothing (cancelled). Never call it on your own initiative.",
    inputSchema: z.object({
      runId: z.string().describe("runId returned by recordIrrigation or correctIrrigation."),
      confirmed: z.boolean(),
    }),
    outputSchema: IrrigationConfirmationSchema,
    execute: async ({ runId, confirmed }, ctx) => {
      const memberId = memberIdFrom(ctx);
      const farmId = farmIdFrom(ctx);
      if (!ctx.mastra) throw new Error("Mastra is not available to this tool");
      // Mastra's run lookup filters on the workflow: only the workflow that owns the runId
      // finds it.
      let found;
      for (const c of CONFIRMABLE) {
        const workflow = ctx.mastra.getWorkflow(c.workflowId);
        const state = await workflow.getWorkflowRunById(runId);
        if (state) {
          found = { workflow, state, step: c.step };
          break;
        }
      }
      if (!found) throw new Error("unknown confirmation");
      const { workflow, state, step } = found;
      // Refuse before resuming, so a foreign attempt leaves the run suspended for its owner.
      if (state.payload?.memberId !== memberId || state.payload?.farmId !== farmId) {
        throw new Error("this confirmation belongs to another member");
      }
      if (state.status !== "suspended") throw new Error("this confirmation is no longer pending");
      const run = await workflow.createRun({ runId });
      const result = await run.resume({
        step,
        resumeData: { confirmed },
        requestContext: ctx.requestContext,
      });
      if (result.status !== "success") throw new Error(failureMessage(result));
      return IrrigationConfirmationSchema.parse(result.result);
    },
  });

  const getFieldDetails = createTool({
    id: "get_field_details",
    description:
      "Facts about one field: area, tenure, the crop growing today (variety, sowing and expected harvest dates, previous crop), the irrigation system and the latest soil analysis (texture class, pH, organic matter, N, P, K and more). Use it for 'tell me about this field' or soil questions.",
    inputSchema: z.object({ fieldId }),
    outputSchema: FieldDetailsSchema,
    execute: async ({ fieldId }, ctx) => (await serviceOf(ctx)).getFieldDetails(fieldId),
  });

  const getFieldJournal = createTool({
    id: "get_field_journal",
    description:
      "The farm journal: what was done on a field, or on every field (sowing, fertilisation, spraying with its products, irrigation, harvest, tillage, observations). Newest first, at most 20 entries; entries with planned true are not done yet. totals cover the whole range, not only the entries shown: count per type, N, P2O5 and K2O in kg/ha, irrigation mm, number of sprays. Default range: the field's crop season; with no field, the last 365 days. Use it for 'what did I do on...', 'when did I last spray...', 'how much nitrogen this season'. Copy the totals; never add entries up yourself.",
    inputSchema: z.object({
      fieldId: z.number().int().optional().describe(
        "Field id, from resolveField. Leave it out for the whole farm.",
      ),
      type: JournalTypeSchema.optional().describe("Only this kind of operation."),
      from: IsoDateSchema.optional().describe("First day, YYYY-MM-DD."),
      to: IsoDateSchema.optional().describe("Last day, YYYY-MM-DD."),
    }),
    outputSchema: FieldJournalSchema,
    execute: async ({ fieldId, type, from, to }, ctx) =>
      (await serviceOf(ctx)).getFieldJournal({ fieldId, type, from, to }),
  });

  const checkProductUse = createTool({
    id: "check_product_use",
    description:
      "Can a crop protection product go on a field's crop on a day? Finds the product by name or AMM number and gives its E-Phy uses for the crop (target, max dose, max applications, pre-harvest interval, BBCH range, buffer zone near water), the times it was used on the field this season, applicationsLeft, daysToHarvest and preHarvestOk. status ambiguous: list the matches and ask which one, give no verdict. status not_found: say so. authorised false: not authorised on this crop; authorised null: no verdict, say why from the warnings. applicationsLeft is null when the crop has several uses. The crop stage is not checked. Copy the numbers, mention every warning and never invent a rule.",
    inputSchema: z.object({
      product: z.string().min(1).describe("Product name or AMM number, as the farmer said it."),
      fieldId,
      date: IsoDateSchema.optional().describe(
        "Day of the planned spray, YYYY-MM-DD. Default: today.",
      ),
    }),
    outputSchema: ProductCheckSchema,
    execute: async ({ product, fieldId, date }, ctx) =>
      (await serviceOf(ctx)).checkProductUse({ product, fieldId, date }),
  });

  const lookup = FarmLookupQuerySchema.shape;
  const lookupFarmData = createTool({
    id: "lookup_farm_data",
    description:
      `Business and reference data, one table at a time: sale (this farm's grain sales: date, crop, harvest year, tonnes, price EUR/t, revenue), market_price (monthly reference price per crop, EUR/t, the same for every farm; forecast true = a month after the current one), subsidy (this farm's CAP payments per year and scheme), farm_economics (this farm's yearly accounts: output, input costs, net value added, EUR), regional_benchmark (real averages of the farm's region per crop group: yield t/ha, N, P2O5 and K2O kg/ha, pesticide use). Rows are newest first, at most limit (default ${LOOKUP_DEFAULT_ROWS}); count and summary cover every matching row (sale: tonnes, revenue, average price, per crop; subsidy: total EUR, per year). Copy the summary; never add rows up yourself. note says where the data comes from (synthetic true = demo data).`,
    inputSchema: z.object({
      table: LookupTableSchema.describe("The table to read."),
      year: lookup.year.describe("Only this year (sale: the harvest year)."),
      cropCode: lookup.cropCode.describe(
        "Only this crop: a crop code (MAIZ, COWT...) or a crop name in any language. sale, market_price and regional_benchmark only.",
      ),
      limit: lookup.limit.describe(
        `Rows to show, 1 to ${LOOKUP_MAX_ROWS}. Default ${LOOKUP_DEFAULT_ROWS}.`,
      ),
    }),
    outputSchema: FarmLookupSchema,
    execute: async (query, ctx) => (await serviceOf(ctx)).lookupFarmData(query),
  });

  return {
    resolveField,
    getFieldReport,
    showWidget,
    getWeather,
    getIrrigationHistory,
    getFarmAdvice,
    simulateScenario,
    recordIrrigation,
    confirmIrrigation,
    getFieldDetails,
    getFieldJournal,
    checkProductUse,
    correctIrrigation,
    lookupFarmData,
  };
}
