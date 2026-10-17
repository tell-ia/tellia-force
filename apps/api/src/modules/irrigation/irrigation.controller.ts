import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  AdviceQuerySchema,
  IsoDateSchema,
  RecordIrrigationBodySchema,
  SimulateBodySchema,
} from "@tellia/shared/irrigation";
import { validate } from "../../core/validate";
import { type FarmRegistry, type FarmScope, MEMBER_HEADER } from "./farmRegistry";

// Fast path for the web UI and the VAPI tool webhooks: no LLM, no workflow.
// Mount at `/irrigation`. The farm is the caller's: `x-member-id` header, default the main
// contact of the first farm. Fields of another farm are 404.

const FieldParam = z.object({ fieldId: z.coerce.number().int() });
const OperationParam = z.object({ operationId: z.coerce.number().int() });
const OperationsQuery = z.object({
  fieldId: z.coerce.number().int(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
});

type Env = { Variables: { memberId: number; scope: FarmScope } };

export function createIrrigationController(registry: FarmRegistry) {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    const caller = await registry.resolveCaller(c.req.header(MEMBER_HEADER));
    c.set("memberId", caller.memberId);
    c.set("scope", caller.scope);
    await next();
  });
  const service = (c: { get(key: "scope"): FarmScope }) => c.get("scope").service;

  app.get("/advice", validate("query", AdviceQuerySchema), async (c) => {
    const { date } = c.req.valid("query");
    return c.json({ data: await service(c).getFarmAdvice(date) });
  });

  app.get(
    "/fields/:fieldId/report",
    validate("param", FieldParam),
    validate("query", AdviceQuerySchema),
    async (c) => {
      const { fieldId } = c.req.valid("param");
      const { date } = c.req.valid("query");
      return c.json({ data: await service(c).getFieldReport(fieldId, date) });
    },
  );

  app.get(
    "/fields/:fieldId/weather",
    validate("param", FieldParam),
    validate("query", AdviceQuerySchema),
    async (c) => {
      const { fieldId } = c.req.valid("param");
      const { date } = c.req.valid("query");
      return c.json({ data: await service(c).getWeather(fieldId, date) });
    },
  );

  app.post(
    "/fields/:fieldId/simulate",
    validate("param", FieldParam),
    validate("json", SimulateBodySchema),
    async (c) => {
      const { fieldId } = c.req.valid("param");
      const { events, date } = c.req.valid("json");
      return c.json({ data: await service(c).simulateScenario(fieldId, events, date) });
    },
  );

  app.get("/operations", validate("query", OperationsQuery), async (c) => {
    const { fieldId, from, to } = c.req.valid("query");
    return c.json({ data: await service(c).listIrrigations(fieldId, { from, to }) });
  });

  app.post("/operations", validate("json", RecordIrrigationBodySchema), async (c) => {
    const body = c.req.valid("json");
    const memberId = body.memberId ?? c.get("memberId");
    if (!(await c.get("scope").data.getMember(memberId))) {
      throw new HTTPException(400, { message: `member ${memberId} is not on this farm` });
    }
    const record = await service(c).recordIrrigation({
      fieldId: body.fieldId,
      date: body.date,
      mm: body.mm,
      memberId,
      source: "web",
    });
    return c.json({ data: record }, 201);
  });

  // Undo from the app: same rules as a chat correction (a confirmed irrigation of this farm).
  app.delete("/operations/:operationId", validate("param", OperationParam), async (c) => {
    const { operationId } = c.req.valid("param");
    return c.json({ data: await service(c).deleteIrrigation(operationId) });
  });

  return app;
}
