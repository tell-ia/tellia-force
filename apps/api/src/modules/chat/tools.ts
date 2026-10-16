// The eight chat tools. The member comes only from the request context, never from input.

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
import type { IrrigationService } from "../irrigation/irrigation.service";
import { MEMBER_ID_KEY } from "./requestContext";

/** The calling member's id from the request context; throws when absent. */
export function memberIdFrom(ctx: { requestContext?: RequestContext<any> }): number {
  const id = ctx.requestContext?.get(MEMBER_ID_KEY);
  if (typeof id !== "number" || !Number.isInteger(id)) {
    throw new Error("no member in the request context");
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

export function createAdvisorTools(service: IrrigationService) {
  const date = IsoDateSchema.optional().describe("Day to evaluate, YYYY-MM-DD. Default: today.");
  const fieldId = z.number().int().describe("Field id, from resolve_field.");

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
      memberIdFrom(ctx);
      return { matches: await service.resolveField(query) };
    },
  });

  const getFieldReport = createTool({
    id: "get_field_report",
    description:
      "Irrigation advice for one field: decision, mm to apply, root-zone depletion, rain forecast and the reason. All numbers come from the calculation; never compute your own.",
    inputSchema: z.object({ fieldId, date }),
    outputSchema: FieldReportSchema,
    execute: ({ fieldId, date }, ctx) => {
      memberIdFrom(ctx);
      return service.getFieldReport(fieldId, date);
    },
  });

  const getWeather = createTool({
    id: "get_weather",
    description:
      "Daily weather around a date for a field (evapotranspiration, rain, temperatures): 3 days before to 3 days after. Use it for questions about rain or temperatures.",
    inputSchema: z.object({ fieldId, date }),
    outputSchema: z.object({ fieldId: z.number().int(), days: z.array(WeatherDaySchema) }),
    execute: async ({ fieldId, date }, ctx) => {
      memberIdFrom(ctx);
      return { fieldId, days: await service.getWeather(fieldId, date) };
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
      memberIdFrom(ctx);
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
        await runWorkflow(ctx, "farm-advice", { asOf: date }),
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
        await runWorkflow(ctx, "simulate-scenario", { fieldId, events, asOf: date }),
      );
    },
  });

  const recordIrrigation = createTool({
    id: "record_irrigation",
    description:
      "Start recording an irrigation the farmer says they did. Nothing is saved yet: it returns a summary; ask the farmer this summary as a yes/no question, then call confirm_irrigation with their answer.",
    inputSchema: z.object({
      fieldId,
      date: IsoDateSchema.describe("Day the irrigation happened, YYYY-MM-DD."),
      mm: z.number().positive().max(200).describe("Water applied, in mm."),
    }),
    outputSchema: z.object({
      runId: z.string(),
      status: z.literal("awaiting_confirmation"),
      summary: z.string(),
      fieldName: z.string(),
      date: IsoDateSchema,
      mm: z.number(),
    }),
    execute: async ({ fieldId, date, mm }, ctx) => {
      const memberId = memberIdFrom(ctx);
      if (!ctx.mastra) throw new Error("Mastra is not available to this tool");
      const run = await ctx.mastra.getWorkflow("record-irrigation").createRun();
      const result = await run.start({
        inputData: { memberId, fieldId, date, mm },
        requestContext: ctx.requestContext,
      });
      if (result.status !== "suspended") throw new Error(failureMessage(result));
      const p = result.suspendPayload?.confirm ?? result.suspendPayload;
      return {
        runId: run.runId as string,
        status: "awaiting_confirmation" as const,
        summary: p.summary,
        fieldName: p.fieldName,
        date: p.date,
        mm: p.mm,
      };
    },
  });

  const confirmIrrigation = createTool({
    id: "confirm_irrigation",
    description:
      "Finish a record_irrigation run, only with the farmer's explicit answer to its yes/no question: confirmed true saves the irrigation, false discards it. Never call it on your own initiative.",
    inputSchema: z.object({
      runId: z.string().describe("runId returned by record_irrigation."),
      confirmed: z.boolean(),
    }),
    outputSchema: z.object({
      status: z.enum(["saved", "cancelled"]),
      record: IrrigationRecordSchema.optional(),
    }),
    execute: async ({ runId, confirmed }, ctx) => {
      memberIdFrom(ctx);
      if (!ctx.mastra) throw new Error("Mastra is not available to this tool");
      const run = await ctx.mastra.getWorkflow("record-irrigation").createRun({ runId });
      const result = await run.resume({
        step: "confirm",
        resumeData: { confirmed },
        requestContext: ctx.requestContext,
      });
      if (result.status !== "success") throw new Error(failureMessage(result));
      return result.result;
    },
  });

  return {
    resolveField,
    getFieldReport,
    getWeather,
    getIrrigationHistory,
    getFarmAdvice,
    simulateScenario,
    recordIrrigation,
    confirmIrrigation,
  };
}
