import { parseEnv, ServerEnvSchema } from "@tellia/shared/env";

// Validate the environment once at boot. Missing/invalid vars crash loud with
// the offending keys — never silently run with half a config.
export const config = parseEnv(ServerEnvSchema, Deno.env.toObject());

export const corsOrigins = config.CORS_ORIGINS === "*"
  ? "*"
  : config.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
