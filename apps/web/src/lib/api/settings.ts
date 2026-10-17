import { DemoDateStateSchema, SetDemoDateBodySchema, type DemoDateState } from "@tellia/shared";
import { http } from "./core";
import type { Query } from "./cache";

// LIVE: GET/PUT /settings/date. One "today" for the app, the chat, VAPI calls and SMS.

export function getDemoDate(): Promise<DemoDateState> {
  return http.get("/settings/date", DemoDateStateSchema);
}

/** `null` goes back to the server's default date. */
export function setDemoDate(date: string | null): Promise<DemoDateState> {
  return http.put("/settings/date", SetDemoDateBodySchema.parse({ date }), DemoDateStateSchema);
}

/** The server's date, kept across launches: screens key their data on it from the first frame. */
export const demoDateQuery: Query<DemoDateState> = {
  key: "demoDate",
  load: getDemoDate,
  schema: DemoDateStateSchema,
  persist: true,
  freshMs: 0,
};
