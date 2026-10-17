import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config, corsOrigins } from "./config";
import { onError } from "./core/middleware";
import { createMastra, mountChat } from "./modules/chat/mastra";
import { data, TABLES } from "./modules/data/data.controller";
import { members } from "./modules/members/members.controller";
import { createSupabaseFarmDirectory } from "./modules/irrigation/data/supabaseFarmData";
import { createFarmRegistry } from "./modules/irrigation/farmRegistry";
import { createIrrigationController } from "./modules/irrigation/irrigation.controller";
import { createClock, fileDemoDateStore } from "./modules/settings/clock";
import { createSettingsController } from "./modules/settings/settings.controller";
import { createVapiController, memberByPhoneIn } from "./modules/vapi/vapi.controller";
import { closeOpenSmsConversations } from "./modules/vapi/vapiSessions";
import { db } from "./supabase";

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: corsOrigins,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "x-member-id"],
  }),
);
app.onError(onError);

// Liveness + the list of readable tables.
app.get("/health", (c) => c.json({ data: { status: "ok", ts: Date.now(), tables: TABLES } }));

// Generic read access to Supabase tables (front never hits Supabase directly).
app.route("/data", data);

// Set a member's phone (VAPI persona hack — see members.controller.ts).
app.route("/members", members);

// The project's "today": the demo date picked in the app (kept in data/, git-ignored), else
// DEMO_DATE, else the real date. Everything below reads it through registry.today().
const clock = createClock({
  timezone: config.TIMEZONE,
  fallback: config.DEMO_DATE,
  store: fileDemoDateStore("./data/demo-date.json"),
});
const vapiKey = config.VAPI_PRIVATE_KEY;
app.route(
  "/settings",
  createSettingsController(clock, {
    // An open SMS conversation remembers the old day: close it, so the next text asks the tools.
    onDateChange: vapiKey
      ? () =>
        closeOpenSmsConversations({ privateKey: vapiKey }).then(
          (n) => console.log(`VAPI: ${n} SMS conversation(s) closed for the new date`),
          (e) => console.error("VAPI: could not close the SMS conversations:", e),
        )
      : undefined,
  }),
);

// Irrigation advisor, fast path (no LLM): used by the web UI and VAPI tool webhooks.
// Several farms share the DB: each request works on the caller's farm (x-member-id header).
const registry = createFarmRegistry({
  directory: createSupabaseFarmDirectory(db),
  today: () => clock.today(),
});
app.route("/irrigation", createIrrigationController(registry));

// VAPI phone assistant: tool calls during a call. The caller's farm comes from their phone number.
app.route(
  "/vapi",
  createVapiController({
    registry,
    secret: config.VAPI_WEBHOOK_SECRET,
    memberByPhone: memberByPhoneIn(db),
  }),
);

// Chat advisor (Mastra): GET /chat/history, POST /chat (AI SDK v7 stream) and /api/*.
// LibSQL needs its directory to exist before it opens the file.
if (config.MASTRA_DB_URL.startsWith("file:")) {
  const dir = config.MASTRA_DB_URL.slice("file:".length).replace(/[^/]*$/, "") || ".";
  Deno.mkdirSync(dir, { recursive: true });
}
const mastra = createMastra({
  registry,
  model: config.MODEL,
  modelMini: config.MODEL_MINI,
  storageUrl: config.MASTRA_DB_URL,
  timezone: config.TIMEZONE,
  openMastraApi: config.OPEN_MASTRA_API,
});
await mountChat(app, { mastra, registry });

Deno.serve({ port: config.PORT }, app.fetch);
// Workers must start or the 05:00 morning-warmup schedule never fires.
await mastra.startWorkers();
console.log(`tellia-force api on http://localhost:${config.PORT}`);
