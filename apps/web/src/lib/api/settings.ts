import { DemoDateStateSchema, SetDemoDateBodySchema, type DemoDateState } from "@tellia/shared";
import { http } from "./core";

// LIVE: GET/PUT /settings/date. One "today" for the app, the chat, VAPI calls and SMS.

export function getDemoDate(): Promise<DemoDateState> {
  return http.get("/settings/date", DemoDateStateSchema);
}

/** `null` goes back to the server's default date. */
export function setDemoDate(date: string | null): Promise<DemoDateState> {
  return http.put("/settings/date", SetDemoDateBodySchema.parse({ date }), DemoDateStateSchema);
}
