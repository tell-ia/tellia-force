import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type VoiceSession, VoiceSessionSchema } from "@tellia/shared/app";
import { type FarmRegistry, MEMBER_HEADER } from "../irrigation/farmRegistry";

// Voice input for the chat. Mount at `/voice`. POST /voice/session mints a short-lived OpenAI
// Realtime key for one transcription session: the app streams the mic to OpenAI over WebRTC and
// gets the words back live, the real OPENAI_API_KEY stays here.

export const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
/** Streams words while the farmer speaks. No server VAD: the app commits when they tap stop. */
export const TRANSCRIBE_MODEL = "gpt-live-transcribe";
/** Time to open the connection; a session already open outlives it. */
const KEY_TTL_SECONDS = 120;
const MAX_KEYWORDS = 100;

export function createVoiceController(deps: {
  registry: FarmRegistry;
  apiKey: string;
  /** OpenAI fetch, injectable for tests. */
  fetch?: typeof fetch;
}) {
  const { registry, apiKey } = deps;
  const fetchOpenAI = deps.fetch ?? fetch;
  const app = new Hono();

  app.post("/session", async (c) => {
    const { memberId, scope } = await registry.resolveCaller(c.req.header(MEMBER_HEADER));
    const [fields, members] = await Promise.all([scope.data.listFields(), scope.data.listMembers()]);
    // Field names are French, Spanish or Italian: as keywords they keep their spelling
    // ("Le Puits", not "Le Puy"), and the farmer's language joins English as a hint.
    const keywords = [...new Set(fields.map((f) => f.name))].sort().slice(0, MAX_KEYWORDS);
    const language = members.find((m) => m.id === memberId)?.language ?? "fr";
    const languages = [...new Set(["en", language])];

    const res = await fetchOpenAI(CLIENT_SECRETS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: KEY_TTL_SECONDS },
        session: {
          type: "transcription",
          audio: {
            input: {
              // A phone held at arm's length, outdoors.
              noise_reduction: { type: "far_field" },
              transcription: { model: TRANSCRIBE_MODEL, languages, keywords },
              turn_detection: null,
            },
          },
        },
      }),
    });
    if (!res.ok) {
      console.error(`voice: OpenAI client secret HTTP ${res.status}: ${await res.text()}`);
      throw new HTTPException(502, { message: "Voice input is unavailable right now" });
    }
    const body = (await res.json()) as { value?: string; expires_at?: number };
    const session: VoiceSession = VoiceSessionSchema.parse({
      clientSecret: body.value,
      expiresAt: body.expires_at,
      model: TRANSCRIBE_MODEL,
    });
    return c.json({ data: session });
  });

  return app;
}
