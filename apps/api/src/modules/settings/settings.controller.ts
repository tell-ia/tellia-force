import { Hono } from "hono";
import {
  DEMO_DATE_MIN,
  type DemoDateState,
  DemoDateStateSchema,
  SetDemoDateBodySchema,
} from "@tellia/shared/app";
import { validate } from "../../core/validate";
import type { Clock } from "./clock";

// The demo date, set from the app's date chip. Mount at `/settings`. No auth (team decision):
// whoever reaches the API moves "today" for every caller, phone and SMS included.

export function createSettingsController(clock: Clock) {
  const app = new Hono();

  const state = (): DemoDateState =>
    DemoDateStateSchema.parse({
      today: clock.today(),
      realToday: clock.realToday(),
      demoDate: clock.demoDate(),
      min: DEMO_DATE_MIN,
      max: clock.realToday(),
    });

  app.get("/date", (c) => c.json({ data: state() }));

  app.put("/date", validate("json", SetDemoDateBodySchema), (c) => {
    const { date } = c.req.valid("json");
    clock.setDemoDate(date);
    console.log(`demo date: ${date ?? "off"} (today is ${clock.today()})`);
    return c.json({ data: state() });
  });

  return app;
}
