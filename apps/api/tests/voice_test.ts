import { assert, assertEquals } from "@std/assert";
import { Hono } from "hono";
import { VoiceSessionSchema } from "@tellia/shared/app";
import { onError } from "../src/core/middleware";
import {
  CLIENT_SECRETS_URL,
  createVoiceController,
  TRANSCRIBE_MODEL,
} from "../src/modules/voice/voice.controller";
import { makeTestRegistry } from "./helpers/testApp";

/** The /voice router over the two test farms, with OpenAI replaced by `reply`. */
function voiceApp(reply: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch: typeof fetch = (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(reply());
  };
  const app = new Hono();
  app.onError(onError);
  app.route(
    "/voice",
    createVoiceController({ registry: makeTestRegistry(), apiKey: "sk-test", fetch: fakeFetch }),
  );
  return { app, calls };
}

const minted = () => Response.json({ value: "ek_abc", expires_at: 1_900_000_000, session: {} });

Deno.test("voice: mints a transcription key with the caller's field names", async () => {
  const { app, calls } = voiceApp(minted);
  const res = await app.request("/voice/session", { method: "POST", headers: { "x-member-id": "5" } });
  assertEquals(res.status, 200);
  const { data } = await res.json();
  assertEquals(VoiceSessionSchema.parse(data), {
    clientSecret: "ek_abc",
    expiresAt: 1_900_000_000,
    model: TRANSCRIBE_MODEL,
  });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, CLIENT_SECRETS_URL);
  assertEquals((calls[0].init.headers as Record<string, string>).Authorization, "Bearer sk-test");
  const body = JSON.parse(String(calls[0].init.body));
  assertEquals(body.session.type, "transcription");
  const input = body.session.audio.input;
  assertEquals(input.turn_detection, null);
  assertEquals(input.transcription.model, TRANSCRIBE_MODEL);
  // Member 5 is on farm 2 (Spanish): its fields, not farm 1's, and Spanish next to English.
  assertEquals(input.transcription.languages, ["en", "es"]);
  const farm2 = await (await makeTestRegistry().forFarm(2)).data.listFields();
  assertEquals(input.transcription.keywords, [...new Set(farm2.map((f) => f.name))].sort());
});

Deno.test("voice: an OpenAI failure is a 502 that hides the upstream error", async () => {
  const { app } = voiceApp(() => new Response("bad key sk-test", { status: 401 }));
  const res = await app.request("/voice/session", { method: "POST" });
  assertEquals(res.status, 502);
  const text = await res.text();
  assert(!text.includes("sk-test"));
});

Deno.test("voice: an unknown member is a 400 and never calls OpenAI", async () => {
  const { app, calls } = voiceApp(minted);
  const res = await app.request("/voice/session", { method: "POST", headers: { "x-member-id": "999" } });
  assertEquals(res.status, 400);
  assertEquals(calls.length, 0);
});
