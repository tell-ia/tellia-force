import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config, corsOrigins } from "./config";
import { onError } from "./core/middleware";
import { data, TABLES } from "./modules/data/data.controller";

const app = new Hono();

app.use("*", logger());
app.use("*", cors({ origin: corsOrigins, credentials: true }));
app.onError(onError);

// Liveness + the list of readable tables.
app.get("/health", (c) => c.json({ data: { status: "ok", ts: Date.now(), tables: TABLES } }));

// Generic read access to Supabase tables (front never hits Supabase directly).
app.route("/data", data);

Deno.serve({ port: config.PORT }, app.fetch);
console.log(`tellia-force api on http://localhost:${config.PORT}`);
