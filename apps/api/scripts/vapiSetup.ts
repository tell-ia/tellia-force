// Creates or updates the VAPI phone assistant from code: one VAPI tool per entry of
// vapi.tools.ts, the assistant "Jean", and the phone number's link to it.
// Safe to re-run (tools match by function name, the assistant by name). Never deletes anything.
//
//   deno task vapi:setup             # apply (needs VAPI_* in .env, see .env.example)
//   deno task vapi:setup --dry-run   # read VAPI, print what would change, write nothing
import { parseEnv } from "@tellia/shared/env";
import { z } from "zod";
import { VAPI_SECRET_HEADER } from "../src/modules/vapi/vapi.controller";
import { vapiFunctions } from "../src/modules/vapi/vapi.tools";

const env = parseEnv(
  z.object({
    VAPI_PRIVATE_KEY: z.string().min(1),
    VAPI_WEBHOOK_SECRET: z.string().min(16),
    VAPI_SERVER_URL: z.url(),
    VAPI_PHONE_NUMBER: z.string().min(1),
    TIMEZONE: z.string().min(1).default("Europe/Paris"),
  }),
  Deno.env.toObject(),
);
const dryRun = Deno.args.includes("--dry-run");

const ASSISTANT_NAME = "Jean";

const SYSTEM_PROMPT =
  `You are Jean, a phone assistant that helps farmers decide when to irrigate and how much.
Today is {{"now" | date: "%A %-d %B %Y", "${env.TIMEZONE}"}}. Every tool result also has "today" (YYYY-MM-DD); when they differ, trust the tool.

How you speak
- This is a phone call. Use short, simple sentences: one or two per turn, then let the farmer talk.
- No lists, no markdown, no symbols, no field ids. Say "twenty millimetres", not "20 mm".
- Say dates the way people do: "yesterday", "on Tuesday", "the fourteenth of July". Never read "2026-07-14".
- Never invent or compute a number: every number comes from a tool. If a tool fails, say so in one sentence and offer to try again.

How you work
- When the farmer names a field or a crop, call resolve_field first. If several fields match, ask which one, by name.
- "What should I water today?": call get_farm_advice. Start with the most urgent field, talk about three fields at most, then offer details.
- One field: call get_field_report. Give the decision, the millimetres and the reason in your own words.
- Rain, heat or frost: call get_weather.
- "When did I last water?": call get_irrigation_history.
- "What if..." (rain, drought, flood, frost, hail, an irrigation): call simulate_scenario and say what changes. Nothing is saved.
- The farmer says they irrigated: find the field, then repeat the field, the day and the millimetres and ask "Shall I save it?". Call record_irrigation only after a clear yes. If it is refused, say why.
- One watering is at most 35 millimetres. When more water is needed, say it will be split over several days.
- Decisions: irrigate_today = water today; frost_hold = wait, frost risk; wait_for_rain = rain is coming; no_irrigation = the soil has enough water; not_irrigable = the field has no irrigation; outside_season = no crop is growing.
- Only talk about irrigation, weather and the farm's fields. For anything else, say kindly that you can only help with irrigation.`;

interface VapiTool {
  id: string;
  function?: { name?: string };
}
interface VapiAssistant {
  id: string;
  name?: string;
}
interface VapiPhoneNumber {
  id: string;
  number?: string;
  assistantId?: string | null;
}

async function vapi<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (dryRun && method !== "GET") {
    console.log(`[dry-run] ${method} ${path}\n${JSON.stringify(body, null, 2)}`);
    return { id: `dry-run:${path}` } as T;
  }
  const res = await fetch(`https://api.vapi.ai${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.VAPI_PRIVATE_KEY}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`VAPI ${method} ${path} -> ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

// 1. Tools: all call POST {VAPI_SERVER_URL}/vapi/tools with the shared secret.
const server = {
  url: `${env.VAPI_SERVER_URL.replace(/\/+$/, "")}/vapi/tools`,
  headers: { [VAPI_SECRET_HEADER]: env.VAPI_WEBHOOK_SECRET },
};
const existingTools = await vapi<VapiTool[]>("GET", "/tool?limit=1000");
const toolIds: string[] = [];
for (const fn of vapiFunctions()) {
  const found = existingTools.find((t) => t.function?.name === fn.name);
  const tool = found
    ? await vapi<VapiTool>("PATCH", `/tool/${found.id}`, { function: fn, server })
    : await vapi<VapiTool>("POST", "/tool", { type: "function", function: fn, server });
  toolIds.push(tool.id);
  console.log(`tool ${fn.name}: ${found ? "updated" : "created"} (${tool.id})`);
}

// 2. Assistant. Voice and transcriber are the ones of VAPI's English demo assistant.
const assistantBody = {
  name: ASSISTANT_NAME,
  firstMessage: "Hi, this is Jean, your irrigation assistant. What can I check for you today?",
  model: {
    provider: "openai",
    model: "gpt-4.1",
    temperature: 0.3,
    messages: [{ role: "system", content: SYSTEM_PROMPT }],
    toolIds,
  },
  voice: { provider: "vapi", voiceId: "Elliot" },
  transcriber: { provider: "soniox", model: "stt-rt-v5", language: "en" },
  endCallFunctionEnabled: true,
};
const existingAssistant = (await vapi<VapiAssistant[]>("GET", "/assistant?limit=1000"))
  .find((a) => a.name === ASSISTANT_NAME);
const assistant = existingAssistant
  ? await vapi<VapiAssistant>("PATCH", `/assistant/${existingAssistant.id}`, assistantBody)
  : await vapi<VapiAssistant>("POST", "/assistant", assistantBody);
console.log(
  `assistant "${ASSISTANT_NAME}": ${existingAssistant ? "updated" : "created"} (${assistant.id})`,
);

// 3. Phone number -> assistant.
const phone = (await vapi<VapiPhoneNumber[]>("GET", "/phone-number?limit=1000"))
  .find((p) => p.number === env.VAPI_PHONE_NUMBER);
if (!phone) throw new Error(`phone number ${env.VAPI_PHONE_NUMBER} is not in this VAPI account`);
if (phone.assistantId === assistant.id) {
  console.log(`phone ${phone.number}: already linked`);
} else {
  await vapi("PATCH", `/phone-number/${phone.id}`, { assistantId: assistant.id });
  console.log(`phone ${phone.number}: linked to "${ASSISTANT_NAME}"`);
}
console.log(dryRun ? "dry run: nothing was changed" : `done. Tool calls go to ${server.url}`);
