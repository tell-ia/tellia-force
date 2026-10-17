import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { BriefSmsSchema, SendBriefSmsBodySchema } from "@tellia/shared/app";
import { validate } from "../../core/validate";
import { type FarmRegistry, MEMBER_HEADER } from "../irrigation/farmRegistry";
import { briefText } from "./brief";

// Sends today's brief by SMS (the app's farm panel button). Mount at `/notify`. The farm is the
// caller's (x-member-id), the advice is the engine's for the project's today (demo date included).

export function createNotifyController(deps: {
  registry: FarmRegistry;
  /** Sends one SMS from the farm number; unset = SMS is not configured (no VAPI key). */
  sendSms?(to: string, text: string): Promise<void>;
}) {
  const app = new Hono();

  app.post("/brief-sms", validate("json", SendBriefSmsBodySchema), async (c) => {
    // ?dryRun=1 returns the text without sending it.
    const dryRun = c.req.query("dryRun") === "1";
    if (!dryRun && !deps.sendSms) {
      throw new HTTPException(503, { message: "SMS is not configured on this server (VAPI_PRIVATE_KEY)" });
    }
    const to = c.req.valid("json").phone.replace(/[\s\-().]/g, "");
    const { memberId, scope } = await deps.registry.resolveCaller(c.req.header(MEMBER_HEADER));
    const [farm, member, advice] = await Promise.all([
      scope.data.getFarm(),
      scope.data.getMember(memberId),
      scope.service.getFarmAdvice(),
    ]);
    const text = briefText({
      farmName: farm.name,
      firstName: member?.name.split(" ")[0] ?? "",
      asOf: advice.asOf,
      reports: advice.reports,
    });
    if (!dryRun) await deps.sendSms!(to, text);
    return c.json({ data: BriefSmsSchema.parse({ to, text }) });
  });

  return app;
}
