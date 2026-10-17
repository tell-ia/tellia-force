// The five Mastra workflows. Steps call the irrigation service, never the FAO maths.

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
import { CorrectionActionSchema, IrrigationAmountSchema } from "@tellia/shared/farm";
import { rankReports } from "../../irrigation/engine/report";
import type { FarmRegistry } from "../../irrigation/farmRegistry";
import { FARM_ID_KEY, MEMBER_ID_KEY } from "../requestContext";

export const MORNING_WARMUP_CRON = "0 5 * * *";
export const MORNING_WARMUP_TIMEZONE = "Europe/Paris"; // default

const FarmId = z.number().int();

/** Only the member who started a run (on that farm) may answer its yes/no question. */
function assertStarter(
  requestContext: { get(key: string): unknown },
  started: { memberId: number; farmId: number },
  what: string,
) {
  if (
    requestContext.get(MEMBER_ID_KEY) !== started.memberId ||
    requestContext.get(FARM_ID_KEY) !== started.farmId
  ) {
    throw new Error(`only the member who started this ${what} can confirm it`);
  }
}

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
    // The short report, as the REST farm advice: no season totals, no series.
    execute: async ({ inputData }) =>
      (await serviceFor(inputData.farmId)).getFieldReport(inputData.fieldId, inputData.asOf, {
        full: false,
      }),
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
      assertStarter(requestContext, inputData, "irrigation record");
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

  // --- correct-irrigation ----------------------------------------------------
  const CorrectInput = z.object({
    farmId: FarmId,
    memberId: z.number().int(),
    operationId: z.number().int(),
    action: CorrectionActionSchema,
    date: IsoDateSchema.optional(),
    mm: z.number().optional(),
  });
  const CorrectionAsked = z.object({
    summary: z.string(),
    operationId: z.number().int(),
    fieldId: z.number().int(),
    fieldName: z.string(),
    action: CorrectionActionSchema,
    before: IrrigationAmountSchema,
    after: IrrigationAmountSchema.nullable(),
  });
  const CorrectionPreviewed = CorrectInput.extend(CorrectionAsked.shape);
  const CorrectionDecided = CorrectionPreviewed.extend({ confirmed: z.boolean() });

  const validateCorrection = createStep({
    id: "validate-correction",
    inputSchema: CorrectInput,
    outputSchema: CorrectionPreviewed,
    execute: async ({ inputData }) => {
      const { data, service } = await registry.forFarm(inputData.farmId);
      // The member must belong to the farm whose irrigation the run changes.
      if (!(await data.getMember(inputData.memberId))) {
        throw new Error(`member ${inputData.memberId} is not on farm ${inputData.farmId}`);
      }
      const { operationId, action, date, mm } = inputData;
      const p = await service.previewIrrigationCorrection({ operationId, action, date, mm });
      return {
        ...inputData,
        summary: p.summary,
        fieldId: p.fieldId,
        fieldName: p.fieldName,
        before: p.before,
        after: p.after,
      };
    },
  });
  const confirmCorrection = createStep({
    id: "confirm-correction",
    inputSchema: CorrectionPreviewed,
    outputSchema: CorrectionDecided,
    suspendSchema: CorrectionAsked,
    resumeSchema: z.object({ confirmed: z.boolean() }),
    execute: async ({ inputData, resumeData, suspend, requestContext }) => {
      if (!resumeData) {
        const { summary, operationId, fieldId, fieldName, action, before, after } = inputData;
        return await suspend({ summary, operationId, fieldId, fieldName, action, before, after });
      }
      assertStarter(requestContext, inputData, "irrigation correction");
      return { ...inputData, confirmed: resumeData.confirmed };
    },
  });
  const CorrectionOutput = z.object({
    status: z.enum(["updated", "deleted", "cancelled"]),
    record: IrrigationRecordSchema.optional(),
  });
  const applyCorrection = createStep({
    id: "apply-correction",
    inputSchema: CorrectionDecided,
    outputSchema: CorrectionOutput,
    execute: async ({ inputData }) => {
      if (!inputData.confirmed) return { status: "cancelled" as const };
      const { data, service } = await registry.forFarm(inputData.farmId);
      // The farmer said yes to the values in the question: refuse if the record moved since.
      const now = await data.getIrrigation(inputData.operationId);
      if (now?.date !== inputData.before.date || now?.mm !== inputData.before.mm) {
        throw new Error("this irrigation changed since the question; nothing was changed");
      }
      if (inputData.action === "delete") {
        await service.deleteIrrigation(inputData.operationId);
        return { status: "deleted" as const };
      }
      return {
        status: "updated" as const,
        record: await service.updateIrrigation(inputData.operationId, inputData.after ?? {}),
      };
    },
  });
  const correctIrrigation = createWorkflow({
    id: "correct-irrigation",
    description:
      "Check a change or deletion of a confirmed irrigation, wait for the farmer's yes/no, then apply it or change nothing.",
    inputSchema: CorrectInput,
    outputSchema: CorrectionOutput,
  })
    .then(validateCorrection)
    .then(confirmCorrection)
    .then(applyCorrection)
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
        targets.map((t) => t.service.getFieldReport(t.fieldId, asOf, { full: false })),
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

  return { farmAdvice, simulateScenario, recordIrrigation, correctIrrigation, morningWarmup };
}

export type AdvisorWorkflows = ReturnType<typeof createAdvisorWorkflows>;
