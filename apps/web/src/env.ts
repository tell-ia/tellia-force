import { env } from "@tellia/shared";

// Validate VITE_* env at boot. import.meta.env is statically replaced by Vite.
export const clientEnv = env.parseEnv(env.ClientEnvSchema, {
  VITE_API_URL: import.meta.env.VITE_API_URL,
  VITE_VAPI_PHONE_NUMBER: import.meta.env.VITE_VAPI_PHONE_NUMBER,
  VITE_VAPI_PUBLIC_KEY: import.meta.env.VITE_VAPI_PUBLIC_KEY,
  VITE_API_MODE: import.meta.env.VITE_API_MODE,
});
