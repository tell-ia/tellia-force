// Creates or updates the VAPI phone assistant from code: one VAPI tool per entry of
// vapi.tools.ts, the assistant "Jean", and the phone number's link to it.
// Safe to re-run (tools match by function name, the assistant by name). Never deletes anything.
//
//   deno task vapi:setup             # apply (needs VAPI_* in .env, see .env.example)
//   deno task vapi:setup --dry-run   # read VAPI, print what would change, write nothing
import { createClient } from "@supabase/supabase-js";
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
    SUPABASE_URL: z.url(),
    SUPABASE_SECRET_KEY: z.string().min(1),
  }),
  Deno.env.toObject(),
);
const dryRun = Deno.args.includes("--dry-run");

const ASSISTANT_NAME = "Jean";

const SYSTEM_PROMPT =
  `You are Jean, a phone assistant that helps farmers decide when to irrigate and how much.
Today is the "today" date (YYYY-MM-DD) in every tool result, even when it is in the past: the app can set a demo date. You do not know today until a tool tells you: never guess a date, and call tools without a date for today. If you need today's date first (for "yesterday" or a weekday), call resolve_field or get_farm_advice without a date.

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
- Facts about a field (crop, variety, sowing date, soil, irrigation equipment): call get_field_details.
- What was done on a field (sowing, fertiliser, sprays, harvest) or "how much nitrogen this season": call get_field_journal and use its totals. Planned work is not done yet.
- "Can I still spray this product on this field?": call check_product_use and say its answer with every warning. If several products match, ask which one. Never invent a rule.
- The farmer says they irrigated: find the field, then repeat the field, the day and the millimetres and ask "Shall I save it?". Call record_irrigation only after a clear yes. If it is refused, say why.
- The farmer says a recorded irrigation was wrong or must be deleted: find it with get_irrigation_history, repeat the change and ask "Shall I change it?". Call correct_irrigation only after a clear yes. If it is refused, say why.
- Sales, market prices, subsidies, farm accounts or regional averages: call lookup_farm_data and use its summary. Prices with forecast true are forecasts.
- One watering is at most 35 millimetres. When more water is needed, say it will be split over several days.
- Decisions: irrigate_today = water today; frost_hold = wait, frost risk; wait_for_rain = rain is coming; no_irrigation = the soil has enough water; not_irrigable = the field has no irrigation; outside_season = no crop is growing.
- Only talk about irrigation, weather, the farm's fields, their crops and soil, the work done on them, crop protection products, and the farm's sales, crop prices, subsidies and accounts. For anything else, say kindly that you can only help with the farm's fields.`;

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
  assistantId?: string;
}
interface VapiSession {
  id: string;
  status?: string;
  phoneNumberId?: string;
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

// 2. Assistant. The transcriber is the one of VAPI's English demo assistant, told the field
// names of every farm (read only): heard in English, "Le Puits" came back as "Le Puy".
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: fieldRows, error: fieldError } = await db.from("field").select("name");
if (fieldError) throw new Error(`Supabase field names: ${fieldError.message}`);
const fieldNames = [...new Set(fieldRows.map((f) => f.name as string))].sort();
console.log(`transcriber vocabulary: ${fieldNames.length} field names`);

const assistantBody = {
  name: ASSISTANT_NAME,
  firstMessage: "Hi, this is your irrigation assistant. What can I check for you today?",
  model: {
    provider: "openai",
    model: "gpt-4.1",
    temperature: 0.3,
    messages: [{ role: "system", content: SYSTEM_PROMPT }],
    toolIds,
  },
  // Female VAPI voice. Other female voices with version 2: Clara, Layla, Savannah.
  voice: { provider: "vapi", voiceId: "Emma", version: "2" },
  // English calls on a French line: "fr" is a soft hint (not strict) so French names keep their
  // French spelling. customVocabulary is Soniox context.terms, contextGeneral context.general.
  transcriber: {
    provider: "soniox",
    model: "stt-rt-v5",
    languages: ["en", "fr"],
    languageHintsStrict: false,
    customVocabulary: fieldNames,
    contextGeneral: [
      { key: "domain", value: "Farm irrigation" },
      {
        key: "topic",
        value: "A farmer asks about their fields by name (French, Spanish or Italian)",
      },
    ],
  },
  // VAPI plays an office ambience on phone calls by default: keep the line silent.
  backgroundSound: "off",
  // Krisp denoising: removes the caller's background noise (tractor, wind) before transcription.
  backgroundSpeechDenoisingPlan: { smartDenoisingPlan: { enabled: true } },
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

// 3. Phone number -> assistant, for calls and texts. smsEnabled makes VAPI point the Twilio
// number's SMS webhook at itself. VAPI documents SMS for US numbers; French carriers rewrite
// the sender of texts from foreign numbers, so French farmers need a French number.
const phones = await vapi<VapiPhoneNumber[]>("GET", "/phone-number?limit=1000");
const phone = phones.find((p) => p.number === env.VAPI_PHONE_NUMBER);
if (!phone) throw new Error(`phone number ${env.VAPI_PHONE_NUMBER} is not in this VAPI account`);
await vapi("PATCH", `/phone-number/${phone.id}`, { assistantId: assistant.id, smsEnabled: true });
console.log(`phone ${phone.number}: calls and SMS go to "${ASSISTANT_NAME}"`);

// 4. An open SMS conversation keeps a copy of the assistant from when it started (prompt and
// tools), so it would ignore this update. Close the open ones on Jean's numbers: the next text
// starts a new conversation. Calls always use the current assistant. Nothing is deleted.
const jeanIds = new Set([assistant.id, existingAssistant?.id]);
const jeanPhones = new Set(
  phones.filter((p) => p.id === phone.id || jeanIds.has(p.assistantId)).map((p) => p.id),
);
const listed = await vapi<VapiSession[] | { results?: VapiSession[] }>(
  "GET",
  "/session?limit=1000",
);
const open = (Array.isArray(listed) ? listed : listed.results ?? [])
  .filter((s) => s.status === "active" && s.phoneNumberId && jeanPhones.has(s.phoneNumberId));
for (const s of open) await vapi("PATCH", `/session/${s.id}`, { status: "completed" });
console.log(`SMS conversations closed: ${open.length}`);
console.log(dryRun ? "dry run: nothing was changed" : `done. Tool calls go to ${server.url}`);
