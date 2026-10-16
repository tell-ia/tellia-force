import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config";

// Single service-role client. No auth for the hackathon — the API is the only
// thing that talks to Supabase, so it bypasses Row Level Security.
// If you add auth later: swap to the anon key + per-request user tokens.
export const db: SupabaseClient = createClient(
  config.SUPABASE_URL,
  config.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
