import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config, corsOrigins } from "./config";
import { onError } from "./core/middleware";
import { data, TABLES } from "./modules/data/data.controller";
import { createSupabaseFarmData } from "./modules/irrigation/data/supabaseFarmData";
import { createIrrigationController } from "./modules/irrigation/irrigation.controller";
import { createIrrigationService } from "./modules/irrigation/irrigation.service";
import { todayIn } from "./modules/irrigation/engine/util";
import { createWeatherService } from "./modules/irrigation/weather/weatherService";
import { db } from "./supabase";

const app = new Hono();

app.use("*", logger());
app.use("*", cors({ origin: corsOrigins, credentials: true }));
app.onError(onError);

// Liveness + the list of readable tables.
app.get("/health", (c) => c.json({ data: { status: "ok", ts: Date.now(), tables: TABLES } }));

// Generic read access to Supabase tables (front never hits Supabase directly).
app.route("/data", data);

// Irrigation advisor, fast path (no LLM): used by the web UI and VAPI tool webhooks.
const farmData = createSupabaseFarmData(db);
const irrigation = createIrrigationService({
  data: farmData,
  weather: createWeatherService({ data: farmData }),
  today: () => config.DEMO_DATE ?? todayIn(config.TIMEZONE),
});
app.route("/irrigation", createIrrigationController(irrigation));

Deno.serve({ port: config.PORT }, app.fetch);
console.log(`tellia-force api on http://localhost:${config.PORT}`);
