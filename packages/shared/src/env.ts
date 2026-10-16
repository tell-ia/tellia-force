import { z } from "zod";
import { IsoDateSchema } from "./irrigation";

// ---------------------------------------------------------------------------
// Environment schemas — validate config on both sides at boot, fail loud.
// Keep server-only secrets (service role key) OUT of the client schema.
// ---------------------------------------------------------------------------

/** apps/api (Deno) — read from Deno.env. Uses the new Supabase API keys. */
export const ServerEnvSchema = z.object({
  PORT: z.coerce.number().int().default(8000),
  SUPABASE_URL: z.url(),
  // secret key = server-only, bypasses RLS (replaces legacy service_role).
  SUPABASE_SECRET_KEY: z.string().min(1),
  // OpenAI — server-only, never exposed to the browser.
  OPENAI_API_KEY: z.string().min(1),
  // VAPI phone number (E.164) — used server-side for calls/telephony.
  VAPI_PHONE_NUMBER: z.string().min(1),
  // comma-separated allowed origins for CORS; "*" in dev.
  CORS_ORIGINS: z.string().default("*"),
  // Chat / irrigation advisor (Mastra). Model router id; uses OPENAI_API_KEY.
  MODEL: z.string().min(1).default("openai/gpt-6.1-sol"),
  // Cheaper model for light helper work (thread titles, etc.).
  MODEL_MINI: z.string().min(1).default("openai/gpt-6-luna"),
  // Mastra memory + workflow storage (LibSQL). Local file by default.
  MASTRA_DB_URL: z.string().min(1).default("file:./data/mastra.db"),
  // Pin "today" for demos (YYYY-MM-DD); unset = real today.
  DEMO_DATE: IsoDateSchema.optional(),
  // IANA time zone used to compute "today".
  TIMEZONE: z.string().min(1).default("Europe/Paris"),
});
export type ServerEnv = z.infer<typeof ServerEnvSchema>;

/**
 * apps/web (Vite) — only VITE_* vars reach the browser. Never put secrets here.
 * The front talks ONLY to the API; it never touches Supabase directly.
 */
export const ClientEnvSchema = z.object({
  VITE_API_URL: z.url().default("http://localhost:8000"),
  // VAPI phone number (E.164) — safe to expose, shown/used in the front.
  VITE_VAPI_PHONE_NUMBER: z.string().min(1),
});
export type ClientEnv = z.infer<typeof ClientEnvSchema>;

/** Parse + explain failures with the offending keys. */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, unknown>,
): z.infer<T> {
  const r = schema.safeParse(source);
  if (!r.success) {
    const issues = r.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return r.data;
}
