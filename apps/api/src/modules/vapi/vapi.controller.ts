// VAPI tool webhook. During a phone call VAPI posts the assistant's tool calls here and speaks
// the results. Always answers 200 once authenticated (VAPI ignores other statuses): a failed
// call gets `error` instead of `result`. Mount at `/vapi`.

import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { FarmRegistry } from "../irrigation/farmRegistry";
import { VAPI_TOOLS, type VapiCaller } from "./vapi.tools";

/** Header VAPI sends on every tool call; its value is VAPI_WEBHOOK_SECRET. */
export const VAPI_SECRET_HEADER = "x-vapi-secret";

const CustomerSchema = z.object({ number: z.string().optional() }).optional();
const BodySchema = z.object({
  message: z.object({
    type: z.string(),
    toolCallList: z.array(z.object({
      id: z.string(),
      function: z.object({
        name: z.string(),
        // An object today; older VAPI payloads sent a JSON string.
        arguments: z.union([z.record(z.string(), z.unknown()), z.string()]).optional(),
      }),
    })).optional(),
    call: z.object({ customer: CustomerSchema }).optional(),
    customer: CustomerSchema,
    // SMS: the conversation (VAPI "chat" / "session") carries the texter's number, not `call`.
    chat: z.object({ sessionId: z.string().optional(), customer: CustomerSchema }).optional(),
    session: z.object({ id: z.string().optional(), customer: CustomerSchema }).optional(),
  }),
});
type ToolCall = NonNullable<z.infer<typeof BodySchema>["message"]["toolCallList"]>[number];

type ToolResult = { toolCallId: string; result: string } | { toolCallId: string; error: string };

/** VAPI wants flat, one-line strings. */
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, "; ").trim();

export function createVapiController(deps: {
  registry: FarmRegistry;
  /** VAPI_WEBHOOK_SECRET. Unset = every request is refused. */
  secret: string | undefined;
  /** The member whose phone (E.164) this is, or null. */
  memberByPhone(phone: string): Promise<number | null>;
  /** The texter's number from a VAPI SMS conversation id (needs VAPI_PRIVATE_KEY), or null. */
  sessionNumber?(sessionId: string): Promise<string | null>;
}) {
  const { registry } = deps;
  const app = new Hono();

  async function callerFor(phone: string | undefined): Promise<VapiCaller> {
    const memberId = phone ? await deps.memberByPhone(phone) : null;
    const scope = memberId === null ? null : await registry.forMember(memberId);
    if (memberId !== null && scope) return { memberId, scope, known: true };
    // Web calls and unknown numbers: the default farm, read-only.
    return { ...(await registry.resolveCaller(undefined)), known: false };
  }

  async function run(call: ToolCall, caller: VapiCaller): Promise<ToolResult> {
    const toolCallId = call.id;
    const tool = VAPI_TOOLS[call.function.name];
    if (!tool) return { toolCallId, error: `unknown tool ${call.function.name}` };
    try {
      const raw = call.function.arguments;
      const args = typeof raw === "string" ? JSON.parse(raw || "{}") : raw ?? {};
      const result = await tool.run(args, caller);
      return { toolCallId, result: JSON.stringify({ today: registry.today(), ...result }) };
    } catch (err) {
      if (err instanceof z.ZodError) return { toolCallId, error: oneLine(z.prettifyError(err)) };
      if (err instanceof HTTPException || err instanceof SyntaxError) {
        return { toolCallId, error: oneLine(err.message) };
      }
      console.error(`VAPI tool ${call.function.name} failed:`, err);
      return { toolCallId, error: "internal error, try again" };
    }
  }

  app.post("/tools", async (c) => {
    if (!deps.secret || c.req.header(VAPI_SECRET_HEADER) !== deps.secret) {
      throw new HTTPException(401, { message: "invalid VAPI secret" });
    }
    const body = BodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new HTTPException(400, { message: "not a VAPI server message" });
    const { message } = body.data;
    // Other server messages (status updates, reports...) need no answer.
    if (message.type !== "tool-calls") return c.json({});
    const sessionId = message.session?.id ?? message.chat?.sessionId;
    let phone = message.call?.customer?.number ?? message.customer?.number ??
      message.chat?.customer?.number ?? message.session?.customer?.number;
    // An SMS tool call may come without the number: ask VAPI for the conversation's customer.
    if (!phone && sessionId && deps.sessionNumber) {
      phone = (await deps.sessionNumber(sessionId).catch(() => null)) ?? undefined;
    }
    if (!phone) {
      console.warn(`VAPI tool call without a caller number (session ${sessionId ?? "none"})`);
    }
    const caller = await callerFor(phone);
    const calls = message.toolCallList ?? [];
    return c.json({ results: await Promise.all(calls.map((call) => run(call, caller))) });
  });

  return app;
}

/** Looks a caller up by `member.phone` (E.164; spaces, dashes and brackets ignored). */
export function memberByPhoneIn(db: SupabaseClient) {
  return async (phone: string): Promise<number | null> => {
    const e164 = phone.replace(/[\s\-().]/g, "");
    const { data, error } = await db.from("member").select("id").eq("phone", e164).limit(1);
    if (error) throw new HTTPException(500, { message: error.message });
    return data?.[0] ? (data[0].id as number) : null;
  };
}
