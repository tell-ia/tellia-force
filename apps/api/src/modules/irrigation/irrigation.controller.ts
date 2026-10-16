import { Hono } from "hono";
import { z } from "zod";
import {
  AdviceQuerySchema,
  IsoDateSchema,
  RecordIrrigationBodySchema,
  SimulateBodySchema,
} from "@tellia/shared/irrigation";
import { validate } from "../../core/validate";
import type { IrrigationService } from "./irrigation.service";

// Fast path for the web UI and the VAPI tool webhooks: no LLM, no workflow.
// Mount at `/irrigation`.

const FieldParam = z.object({ fieldId: z.coerce.number().int() });
const OperationsQuery = z.object({
  fieldId: z.coerce.number().int(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
});

export function createIrrigationController(service: IrrigationService) {
  const app = new Hono();

  app.get("/advice", validate("query", AdviceQuerySchema), async (c) => {
    const { date } = c.req.valid("query");
    return c.json({ data: await service.getFarmAdvice(date) });
  });

  app.get(
    "/fields/:fieldId/report",
    validate("param", FieldParam),
    validate("query", AdviceQuerySchema),
    async (c) => {
      const { fieldId } = c.req.valid("param");
      const { date } = c.req.valid("query");
      return c.json({ data: await service.getFieldReport(fieldId, date) });
    },
  );

  app.get(
    "/fields/:fieldId/weather",
    validate("param", FieldParam),
    validate("query", AdviceQuerySchema),
    async (c) => {
      const { fieldId } = c.req.valid("param");
      const { date } = c.req.valid("query");
      return c.json({ data: await service.getWeather(fieldId, date) });
    },
  );

  app.post(
    "/fields/:fieldId/simulate",
    validate("param", FieldParam),
    validate("json", SimulateBodySchema),
    async (c) => {
      const { fieldId } = c.req.valid("param");
      const { events, date } = c.req.valid("json");
      return c.json({ data: await service.simulateScenario(fieldId, events, date) });
    },
  );

  app.get("/operations", validate("query", OperationsQuery), async (c) => {
    const { fieldId, from, to } = c.req.valid("query");
    return c.json({ data: await service.listIrrigations(fieldId, { from, to }) });
  });

  app.post("/operations", validate("json", RecordIrrigationBodySchema), async (c) => {
    const body = c.req.valid("json");
    const memberId = body.memberId ?? await service.defaultMemberId();
    const record = await service.recordIrrigation({
      fieldId: body.fieldId,
      date: body.date,
      mm: body.mm,
      memberId,
      source: "app",
    });
    return c.json({ data: record }, 201);
  });

  return app;
}
