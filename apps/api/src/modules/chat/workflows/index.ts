// The four Mastra workflows. Steps call the irrigation service, never the FAO maths.

import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  FarmAdviceSchema,
  FieldReportSchema,
  IrrigationRecordSchema,
  IsoDateSchema,
  ScenarioEventSchema,
  ScenarioResultSchema,
} from "@tellia/shared/irrigation";
import { rankReports } from "../../irrigation/engine/report";
import type { FarmRegistry } from "../../irrigation/farmRegistry";
import { FARM_ID_KEY, MEMBER_ID_KEY } from "../requestContext";

export const MORNING_WARMUP_CRON = "0 5 * * *";
export const MORNING_WARMUP_TIMEZONE = "Europe/Paris"; // default

const FarmId = z.number().int();
const FieldTargetSchema = z.object({
  farmId: FarmId,
  fieldId: z.number().int(),
  asOf: IsoDateSchema,
});

/** Every workflow input carries the caller's farm; steps only touch that farm. */
export function createAdvisorWorkflows(
  registry: FarmRegistry,
  timezone: string = MORNING_WARMUP_TIMEZONE,
) {
  const serviceFor = async (farmId: number) => (await registry.forFarm(farmId)).service;

  // --- farm-advice -----------------------------------------------------------
  const listFields = createStep({
    id: "list-fields",
    inputSchema: z.object({ farmId: FarmId, asOf: IsoDateSchema.optional() }),
    outputSchema: z.array(FieldTargetSchema),
    execute: async ({ inputData }) => {
      const { farmId } = inputData;
      const asOf = inputData.asOf ?? registry.today();
      const { data } = await registry.forFarm(farmId);
      return (await data.listFields()).map((f) => ({ farmId, fieldId: f.id, asOf }));
    },
  });
  const fieldReport = createStep({
    id: "field-report",
    inputSchema: FieldTargetSchema,
    outputSchema: FieldReportSchema,
    execute: async ({ inputData }) =>
      (await serviceFor(inputData.farmId)).getFieldReport(inputData.fieldId, inputData.asOf),
  });
  const rank = createStep({
    id: "rank",
    inputSchema: z.array(FieldReportSchema),
    outputSchema: FarmAdviceSchema,
    execute: ({ inputData, getInitData }) => {
      const asOf = inputData[0]?.asOf ?? getInitData<{ asOf?: string }>().asOf ??
        registry.today();
      return Promise.resolve({ asOf, reports: rankReports(inputData) });
    },
  });
  const farmAdvice = createWorkflow({
    id: "farm-advice",
    description: "Ranked irrigation advice for every field of the farm.",
    inputSchema: z.object({ farmId: FarmId, asOf: IsoDateSchema.optional() }),
    outputSchema: FarmAdviceSchema,
  })
    .then(listFields)
    .foreach(fieldReport, { concurrency: 4 })
    .then(rank)
    .commit();

  // --- simulate-scenario -----------------------------------------------------
  const simulate = createStep({
    id: "simulate",
    inputSchema: z.object({
      farmId: FarmId,
      fieldId: z.number().int(),
      events: z.array(ScenarioEventSchema),
      asOf: IsoDateSchema.optional(),
    }),
    outputSchema: ScenarioResultSchema,
    execute: async ({ inputData }) =>
      (await serviceFor(inputData.farmId)).simulateScenario(
        inputData.fieldId,
        inputData.events,
        inputData.asOf,
      ),
  });
  const ScenarioWithSummary = ScenarioResultSchema.extend({ summary: z.string() });
  const summarize = createStep({
    id: "summarize",
    inputSchema: ScenarioResultSchema,
    outputSchema: ScenarioWithSummary,
    execute: ({ inputData }) =>
      Promise.resolve({ ...inputData, summary: inputData.comparison.summary }),
  });
  const simulateScenario = createWorkflow({
    id: "simulate-scenario",
    description: "What-if simulation on one field, compared with the baseline.",
    inputSchema: simulate.inputSchema,
    outputSchema: ScenarioWithSummary,
  })
    .then(simulate)
    .then(summarize)
    .commit();

  // --- record-irrigation -----------------------------------------------------
  const RecordInput = z.object({
    farmId: FarmId,
    memberId: z.number().int(),
    fieldId: z.number().int(),
    date: IsoDateSchema,
    mm: z.number(),
  });
  const Previewed = RecordInput.extend({ fieldName: z.string(), summary: z.string() });
  const Drafted = Previewed.extend({ operationId: z.number().int() });
  const Decided = Drafted.extend({ confirmed: z.boolean() });

  const validate = createStep({
    id: "validate",
    inputSchema: RecordInput,
    outputSchema: Previewed,
    execute: async ({ inputData }) => {
      const service = await serviceFor(inputData.farmId);
      // The member must belong to the farm the run writes to.
      if (!(await (await registry.forFarm(inputData.farmId)).data.getMember(inputData.memberId))) {
        throw new Error(`member ${inputData.memberId} is not on farm ${inputData.farmId}`);
      }
      const preview = await service.previewIrrigation(inputData);
      return { ...inputData, fieldName: preview.fieldName, summary: preview.summary };
    },
  });
  const draft = createStep({
    id: "draft",
    inputSchema: Previewed,
    outputSchema: Drafted,
    execute: async ({ inputData }) => {
      const rec = await (await serviceFor(inputData.farmId)).createDraftIrrigation({
        fieldId: inputData.fieldId,
        date: inputData.date,
        mm: inputData.mm,
        memberId: inputData.memberId,
      });
      return { ...inputData, operationId: rec.operationId };
    },
  });
  const confirm = createStep({
    id: "confirm",
    inputSchema: Drafted,
    outputSchema: Decided,
    suspendSchema: z.object({
      summary: z.string(),
      operationId: z.number().int(),
      fieldId: z.number().int(),
      fieldName: z.string(),
      date: IsoDateSchema,
      mm: z.number(),
    }),
    resumeSchema: z.object({ confirmed: z.boolean() }),
    execute: async ({ inputData, resumeData, suspend, requestContext }) => {
      if (!resumeData) {
        const { summary, operationId, fieldId, fieldName, date, mm } = inputData;
        return await suspend({ summary, operationId, fieldId, fieldName, date, mm });
      }
      // Only the member who started the run (on that farm) may answer it.
      if (
        requestContext.get(MEMBER_ID_KEY) !== inputData.memberId ||
        requestContext.get(FARM_ID_KEY) !== inputData.farmId
      ) {
        throw new Error("only the member who started this irrigation record can confirm it");
      }
      return { ...inputData, confirmed: resumeData.confirmed };
    },
  });
  const FinishOutput = z.object({
    status: z.enum(["saved", "cancelled"]),
    record: IrrigationRecordSchema.optional(),
  });
  const finish = createStep({
    id: "finish",
    inputSchema: Decided,
    outputSchema: FinishOutput,
    execute: async ({ inputData }) => {
      const service = await serviceFor(inputData.farmId);
      if (inputData.confirmed) {
        return {
          status: "saved" as const,
          record: await service.confirmIrrigation(inputData.operationId),
        };
      }
      await service.cancelIrrigation(inputData.operationId);
      return { status: "cancelled" as const };
    },
  });
  const recordIrrigation = createWorkflow({
    id: "record-irrigation",
    description: "Draft an irrigation record, wait for the farmer's yes/no, then save or discard.",
    inputSchema: RecordInput,
    outputSchema: FinishOutput,
  })
    .then(validate)
    .then(draft)
    .then(confirm)
    .then(finish)
    .commit();

  // --- morning-warmup --------------------------------------------------------
  const WarmupOutput = z.object({
    fields: z.number().int(),
    irrigateToday: z.number().int(),
    failures: z.number().int(),
  });
  const warmup = createStep({
    id: "compute-advice",
    inputSchema: z.object({}),
    outputSchema: WarmupOutput,
    execute: async () => {
      // Every farm, per field, so one failing field does not hide the others; each farm's
      // weather service keeps what this loads for the calls that follow.
      const asOf = registry.today();
      const targets: { service: Awaited<ReturnType<typeof serviceFor>>; fieldId: number }[] = [];
      for (const farmId of await registry.farmIds()) {
        const { data, service } = await registry.forFarm(farmId);
        for (const f of await data.listFields()) targets.push({ service, fieldId: f.id });
      }
      const settled = await Promise.allSettled(
        targets.map((t) => t.service.getFieldReport(t.fieldId, asOf)),
      );
      const firstFailure = settled.find((s) => s.status === "rejected") as
        | PromiseRejectedResult
        | undefined;
      if (firstFailure && settled.every((s) => s.status === "rejected")) {
        const r = firstFailure.reason;
        throw new Error(
          `morning warmup failed for all ${settled.length} fields: ${
            r instanceof Error ? r.message : String(r)
          }`,
        );
      }
      if (firstFailure) {
        console.warn(
          `morning warmup: ${
            settled.filter((s) => s.status === "rejected").length
          } of ${settled.length} fields failed`,
          firstFailure.reason,
        );
      }
      const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
      return {
        fields: ok.length,
        irrigateToday: ok.filter((r) => r.decision === "irrigate_today").length,
        failures: settled.length - ok.length,
      };
    },
  });
  const morningWarmup = createWorkflow({
    id: "morning-warmup",
    description:
      "05:00 job: computes today's advice for every farm so weather and climatology are cached.",
    inputSchema: z.object({}),
    outputSchema: WarmupOutput,
    schedule: {
      cron: MORNING_WARMUP_CRON,
      timezone,
      inputData: {},
    },
  })
    .then(warmup)
    .commit();

  return { farmAdvice, simulateScenario, recordIrrigation, morningWarmup };
}

export type AdvisorWorkflows = ReturnType<typeof createAdvisorWorkflows>;
