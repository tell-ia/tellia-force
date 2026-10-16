# Voice & messaging channels for the Mastra irrigation advisor

Research date: 2026-10-16. Tags: [V] = verified in a primary source (listed in Sources), [U] = unverified / estimate / inference.

## TL;DR

- Recommended voice path: **VAPI option (a)**. VAPI runs STT, its own fast LLM and TTS. The LLM calls our tools through a `tool-calls` webhook (Hono route on the Mastra server). The Mastra agent is not in the voice loop. [V: tool-calls format; U: latency numbers]
- Tool endpoints must call the deterministic FAO-56 code directly (no nested LLM) and return a short pre-formatted string. This keeps tool time to tens of ms plus network.
- (b) Custom LLM needs our own OpenAI-compatible SSE adapter: Mastra's `chatRoute` / `handleChatStream` emit AI SDK UI format, not OpenAI chat completions. [V] It adds a second LLM hop and tool-call plumbing. Not worth it for <2s.
- (c) VAPI MCP tool opens a new MCP connection on each tool invocation [V], which adds overhead. Fine for prototyping (a Mastra `MCPServer` is trivial), not for the 2s budget.
- Mastra voice + Twilio Media Streams could replace VAPI technically, but Mastra docs show no telephony package, so you would own barge-in, endpointing, mulaw transcoding and reconnects. Not recommended for the MVP.
- Messaging: **Telegram** is the quickest to ship (no business verification, free). **WhatsApp** (farmers' real channel) via Twilio sandbox for demo, Meta Cloud API for production. Both map onto `agent.generate(..., { memory: { thread, resource } })` keyed by phone number or chat id.
- **French number gotcha** [V]: Twilio's FR guidelines prohibit automated outbound on Local (+331-5) and Mobile (+336/7) numbers. The morning outbound call needs an NPV or compliant number type, or a different carrier. Check this before buying anything.

## Recommended architecture

```
INBOUND (farmer calls)                       OUTBOUND (morning call, 07:00 cron)
 Farmer phone                                 Scheduler (Deno.cron / Mastra workflow)
   |  PSTN                                      | POST api.vapi.ai/call {assistantId,
   v                                            |   phoneNumberId, customer.number}
 Twilio number (imported into VAPI)             v
   |                                          VAPI -> Twilio -> farmer
   v
 VAPI assistant: [STT Deepgram nova-3 fr] -> [LLM, fast model] -> [TTS 11labs flash v2.5 fr]
   |  tool-calls (HTTPS POST, Bearer/HMAC credential)           ^
   v                                                            | result string (<~300 ms)
 Deno.serve + Mastra (@mastra/hono) ----- /vapi/tools ---------+
   |- resolve_parcel / get_parcel_report / simulate_scenario / get_weather  (deterministic FAO-56 code, no LLM)
   |- /vapi/events : end-of-call-report -> log irrigation records (DB)
   |
 TEXT CHANNELS
 WhatsApp (Twilio or Meta) / Telegram --webhook--> /wa/webhook, /tg/webhook
   -> mastra.getAgent('advisor').generate(text, {memory:{thread:`wa:+33...`, resource:'+33...'}})
   -> reply via provider API (agent calls same tools; allowed to take 3-8 s)
```

Design rule: voice = tools only, thin and fast. Text = full Mastra agent with memory.

## 1. Mastra voice

Packages [V, mastra.ai voice overview]: `@mastra/voice-openai` (TTS+STT), `-openai-realtime` (speech-to-speech), `-azure`, `-elevenlabs`, `-google`, `-google-gemini-live` (STS), `-cloudflare`, `-deepgram`, `-inworld`, `-speechify` (TTS), `-sarvam`, `-murf` (TTS), `-aws-nova-sonic` (STS), `-xai-realtime` (STS). Also Gladia (STT only) and ModelsLab (TTS).

API [V]: `agent.voice.speak(text, opts)` returns an audio stream; `agent.voice.listen(stream)` returns a transcript string; realtime providers use `connect()`, `send(micStream)`, and events `on('speaker')` and `on('writing', {text, role})`. `CompositeVoice` lets you mix providers (e.g. Deepgram STT + ElevenLabs TTS), and delegates `on()` to the realtime provider.

```ts
const agent = new Agent({ id:'v', name:'v', instructions:'...', model:'...', voice: new OpenAIRealtimeVoice() });
await agent.voice.connect();
agent.voice.on('speaker', ({ audio }) => /* send to Twilio WS */);
await agent.voice.send(micStream);
```

**Mastra voice + Twilio Media Streams instead of VAPI?**

| Pros | Cons |
|---|---|
| One stack, no VAPI per-minute fee ($0.05/min hosting [V]) | Mastra voice docs show no telephony integration; only a mention of LiveKit for phone [V]. You write the Twilio WebSocket bridge yourself |
| Full control, deterministic tools called in-process | You own VAD/barge-in, endpointing, mulaw 8 kHz <-> PCM resampling, silence, reconnects [U] |
| Can use OpenAI Realtime (STS) for low latency | Realtime voice runs on a persistent WS from Deno; Mastra voice package Deno compatibility not verified [U] |
| | Still need Twilio number + FR regulatory work |

Verdict: viable later if VAPI cost/latency hurts; not for the MVP.

## 2. VAPI + Mastra options

### (a) Tools via server URL webhook (RECOMMENDED)

Request [V, docs.vapi.ai/server-url/events]: `POST` with `{ message: { type:"tool-calls", call, toolCallList:[{id,type:"function",function:{name,arguments:{...}}}], toolWithToolCallList:[...] } }`.
Response [V]: HTTP 200 `{ "results":[{ "name", "toolCallId", "result": "<flat string>" }] }`. Use `error` instead of `result` for failure; objects must be JSON.stringified; one entry per call.
Timeouts: tool-calls timeout is not documented on the pages read [U]. `apiRequest` tools default `timeoutSeconds` 20 and do not retry [V]. The 7.5 s limit applies to `assistant-request` only [V]. Set a short timeout (e.g. 5 s) in tool/server config and keep handlers fast. A tool can also be async [V, mentioned only].
Auth [V, server-authentication]: create a Custom Credential (Bearer in any header, OAuth2, or HMAC) and reference by `credentialId`. Legacy `X-Vapi-Secret` = Bearer cred with that header name and no prefix. Credentials are attached only when the server URL comes from org config (saved tool/assistant/phone number), not from inline API overrides.
URL precedence [V]: tool, then assistant, then phone number, then org.

Handler as a Mastra route (Hono context, `c.get('mastra')` [V]):

```ts
import { registerApiRoute } from '@mastra/core/server';
import { getParcelReport, resolveParcel, simulateScenario } from './domain/irrigation.ts'; // deterministic

const handlers: Record<string, (a: any) => Promise<unknown>> = {
  resolve_parcel: a => resolveParcel(a.query),
  get_parcel_report: a => getParcelReport(a.parcel_id),
  simulate_scenario: a => simulateScenario(a.parcel_id, a.events, a.date),
};

export const vapiTools = registerApiRoute('/vapi/tools', {
  method: 'POST',
  handler: async (c) => {
    if (c.req.header('authorization') !== `Bearer ${Deno.env.get('VAPI_TOOL_SECRET')}`) return c.text('unauthorized', 401);
    const { message } = await c.req.json();
    if (message?.type !== 'tool-calls') return c.json({}); // other message types: ack
    const results = await Promise.all(message.toolCallList.map(async (t: any) => {
      try {
        const out = await handlers[t.function.name](t.function.arguments);
        // Keep it SHORT and speakable; the LLM reads this aloud. Do not return a 5 KB JSON blob.
        return { name: t.function.name, toolCallId: t.id, result: typeof out === 'string' ? out : JSON.stringify(out) };
      } catch (e) {
        return { name: t.function.name, toolCallId: t.id, error: String(e) };
      }
    }));
    return c.json({ results });
  },
});
// new Mastra({ server: { apiRoutes: [vapiTools, vapiEvents, waWebhook, tgWebhook] } })
```
Tip: make `get_parcel_report` return pre-composed French text (field, when, mm, why) so the voice LLM only has to read it. Call identity: `message.call.customer.number` identifies the farmer. [U on exact field path; shown as "Call Object" in docs]

End-of-call report [V]: `message.type === "end-of-call-report"` with `endedReason`, `call`, `artifact{recording, transcript, messages}`. Summary/cost/duration fields are not documented on that page [U]. Informational, no response needed. To log irrigation records, prefer logging at tool time (an explicit `log_irrigation(parcel_id, mm, date)` tool) and use the report only for transcript/audit; do not parse the transcript for numbers.

### (b) Custom LLM -> Mastra agent

VAPI side [V]: Model = Custom LLM, URL of your server; docs example route `/chat/completions`; response must be SSE (`text/event-stream`, `data: {...}` chunks, end `data: [DONE]`); optional API-key or OAuth2 auth; tool calls can be streamed OpenAI-style, with custom tools still executed by VAPI via `toolCallList`. Whether VAPI appends `/chat/completions` to the base URL is not confirmed [U].
Mastra side [V]: `chatRoute` and `handleChatStream` (from `@mastra/ai-sdk`) emit AI SDK UI message streams, not OpenAI chunks. I found no built-in OpenAI-compatible chat completions endpoint in Mastra docs [U: absence of evidence]. So you write an adapter: `agent.stream(messages)`, map text deltas to `chat.completion.chunk` SSE.
Cost: an extra hop plus an extra LLM call whose tool loop runs inside Mastra (tool call = LLM round trip, then second LLM generation). Likely 1-2 s for the first token with tools [U]. Benefit: one agent definition, Mastra memory and instructions shared with text channels. Only choose it if you need shared agent behaviour more than latency.

### (c) VAPI MCP tool -> Mastra `MCPServer`

VAPI [V]: tool type `mcp`, `server.url`, optional `server.headers`, Streamable HTTP default (SSE deprecated); tools fetched at call start; **a new connection per tool invocation**; headers `X-Call-Id`. No mid-call refresh. Large tool lists add latency.
Mastra [V]: registered `MCPServer` is served at `/api/mcp/:serverId/mcp` (Streamable HTTP). Convenient (no handler code, one tool definition for text agent and voice), but extra connection handshake per call. Good for dev, second choice for prod.

### Recommendation

(a). Define the 4 tools once as pure functions, wrap them with `createTool` for the Mastra text agent and expose the same functions through `/vapi/tools`. Optionally also register an `MCPServer` for Claude/dev use.

## 3. VAPI configuration

- Assistant: `model` (provider/model chosen by you; pick a small fast one), `transcriber`, `voice`, `firstMessage`, tools, `serverUrl`/server messages.
- French STT [V]: Deepgram `nova-3` or `nova-2` support `fr` (also `multi`, `fr-CA`). Other providers: see transcriber overview page [U, not read].
- French TTS [V]: ElevenLabs `eleven_flash_v2_5`, `eleven_multilingual_v2`, `eleven_v3` support French; Flash v2 does not. Config: `"voice":{"provider":"11labs","model":"eleven_flash_v2_5","voiceId":"..."}`; `optimizeStreamingLatency` 0-4 (default 3). Pick a French voice id from the Voice Library.
- Outbound [V]: `POST /call` with `assistantId` (or inline `assistant`), `phoneNumberId`, `customer.number`; optional `schedulePlan{earliestAt, latestAt}`; batch via `customers[]`. `assistantOverrides`/`variableValues` schema is in the API reference, not read [U]. Free VAPI numbers cannot place outbound or international calls [V]; import a Twilio/Vonage/Telnyx number instead.
- Pricing [V, vapi.ai/pricing]: $5 free credits; $0.05/min hosting; 4 concurrent calls; 1 included number; Core $29/mo (10 concurrent). Provider costs on top: Deepgram ~$0.01/min, OpenAI model ~$0.008-0.045/min, ElevenLabs ~$0.015-0.024/min, Twilio inbound ~$0.008/min. Page's estimate: $82-129/month for 1,000 min. The pricing page is JS-rendered; recheck at signup [U].
- Import Twilio number [V]: Twilio Account SID + Auth Token + number (E.164) in Dashboard > Phone Numbers > Import Twilio; assign assistant.
- Free VAPI number [V]: US numbers only per free-telephony page title ("free US phone numbers"); useless for France callers (international cost) and no outbound.

## 4. Twilio

- Trial [V]: verified recipients only (up to 5), 30-day trial, per-product free units (e.g. 100 SMS, 100 WhatsApp, 75 voice min). Custom message bodies unavailable on trial per page (templates). Upgrade = profile, address, balance, card.
- France numbers [V, twilio.com/en-us/guidelines/fr/regulatory]:
  - Local +331-5 and National +339: voice only, no SMS; automated outbound prohibited.
  - Mobile +336/7: voice+SMS; A2P and automated outbound prohibited.
  - Technical Platform (+3393903/24/20): SMS A2P and inbound calling ok; one-way calling prohibited.
  - Verified Polyvalent (NPV): automated outbound allowed, no SMS.
  - Docs: identity + proof of address (individual), K-bis/SIREN/website/representative (business). Local needs a French local address.
  - Implication: inbound to a FR local number is fine; the automated morning call likely needs an NPV number or a non-Twilio SIP trunk (e.g. a French carrier) [U on availability in Twilio's inventory]. Resolve before building the cron.
- SMS: FR Mobile numbers support SMS but not A2P; for notifications use a Technical Platform number or alphanumeric sender [U]. Messaging is optional given WhatsApp/Telegram.
- WhatsApp sandbox [V]: shared number +14155238886, users send `join <code>`, 24 h session window, 3-day join expiry, 1 msg/3 s, only 3 templates, not for production. Production needs your own sender via WhatsApp Self Sign-up.

## 5. WhatsApp vs Telegram

| | Twilio WhatsApp | Meta Cloud API | Telegram |
|---|---|---|---|
| Setup | Sandbox instantly; prod sender requires Meta approval via Twilio | Meta app + WABA + test number; business verification for prod [U] | BotFather token, 2 min |
| Inbound payload | Twilio form-encoded `From=whatsapp:+33..`, `Body` [U] | JSON `entry[].changes[].value.messages[]`, `contacts[].wa_id` [V] | `update.message.chat.id`, `text` [V] |
| Webhook verify | Twilio signature [U] | `hub.challenge` GET handshake [U, not on page read] | `secret_token` header `X-Telegram-Bot-Api-Secret-Token` [V] |
| Cost | Twilio fee + Meta fee [U] | Per-message pricing since 2025-07-01; replies within the 24 h window are free, free-form only within window, templates otherwise [V] | Free [U] |
| Fit for farmers | Best reach | Best reach, cheapest | Lower reach; best for dev/demo |

The morning proactive message (outside the 24 h window) requires an approved template on WhatsApp [V]. Telegram has no such limit.

Telegram webhook -> Mastra with memory per chat:

```ts
registerApiRoute('/tg/webhook', {
  method: 'POST',
  handler: async (c) => {
    if (c.req.header('x-telegram-bot-api-secret-token') !== Deno.env.get('TG_SECRET')) return c.text('no', 401);
    const u = await c.req.json();
    const msg = u.message; if (!msg?.text) return c.json({ ok: true });
    const chatId = String(msg.chat.id);
    // Ack fast; process async to avoid Telegram retries on slow LLM calls
    queueMicrotask(async () => {
      const agent = c.get('mastra').getAgent('advisor');
      const res = await agent.generate(msg.text, { memory: { thread: `tg:${chatId}`, resource: `tg:${chatId}` } });
      await fetch(`https://api.telegram.org/bot${Deno.env.get('TG_TOKEN')}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: res.text }) });
    });
    return c.json({ ok: true });
  },
});
```
`memory: { thread, resource }` is the documented option [V, Mastra working-memory docs]. For WhatsApp, use `resource = wa_id` (E.164) and `thread = wa:<wa_id>` (one thread per farmer; or per day if you want fresh context). Use the same `resource` for voice callers (`message.call.customer.number`) so that parcel/preferences working memory is shared across channels. Map phone -> farmer/parcels in our DB, not in the LLM.

## 6. Mastra MCP

```ts
import { MCPServer, MCPClient } from '@mastra/mcp';
const server = new MCPServer({ id:'irrigation', name:'Irrigation', version:'1.0.0',
  tools: { resolveParcelTool, getParcelReportTool, simulateScenarioTool }, agents: { advisor } }); // agents -> ask_<name>
export const mastra = new Mastra({ mcpServers: { server }, agents: { advisor } });
// served at /api/mcp/irrigation/mcp (Streamable HTTP) [V]
const client = new MCPClient({ servers: { docs: { url: new URL('https://example.com/mcp') } } });
new Agent({ id:'a', tools: await client.listTools() }); // namespaced serverName_toolName [V]
```
Deno note: `startHTTP` expects Node req/res; docs show a `fetch-to-node` shim for Deno-like runtimes [V]. When using `mcpServers` on `Mastra` with `@mastra/hono`, the route is auto-registered [V per docs; U on Deno specifics].

## Latency budget (<2 s from end of farmer speech to start of audio reply) [all U: engineering estimates, measure in VAPI call logs]

| Stage | Target |
|---|---|
| Endpointing (silence detect) | 300-500 ms |
| STT final (Deepgram streaming) | ~100-200 ms |
| LLM decides + emits tool call (small fast model) | 300-500 ms |
| Network VAPI -> our server (host in EU, near VAPI region) + handler | 50-150 ms (handler pure compute, cached weather/ET0) |
| LLM generates answer (first tokens) | 300-500 ms |
| TTS first audio (Flash v2.5) | 150-300 ms |
| Telephony | 50-100 ms |
| Total | ~1.3-2.2 s |
Mitigations: precompute the morning report so `get_parcel_report` is a lookup; one tool call per turn; request-start filler message ("Je regarde...") for `simulate_scenario`; keep tool results under ~60 words; avoid custom LLM / MCP hops; shortest system prompt; host the server close to VAPI. VAPI docs recommend hosting near us-west-2 for assistant-request [V]; for EU callers measure both.

## Accounts and costs

| Service | Needed for | Account? | Free tier / trial | Gotchas |
|---|---|---|---|---|
| VAPI | Voice orchestration | Yes | $5 free credits; $0.05/min hosting after [V] | 4 concurrent calls on base plan; provider costs billed on top; free number = US, inbound only [V] |
| Twilio | Phone number, PSTN, WhatsApp sandbox | Yes (+ upgrade for production) | 30 days, verified numbers only (<=5), limited free units [V] | FR regulatory docs (ID/address, K-bis); automated outbound banned on Local/Mobile [V] |
| Deepgram / ElevenLabs / LLM | STT / TTS / reasoning | Via VAPI (billed by VAPI, or bring own keys [U]) | n/a | Pick `eleven_flash_v2_5` for fr + latency |
| Meta WhatsApp Cloud API | Prod WhatsApp | Meta developer + Business (WABA) | Test number; replies in 24 h window free [V] | Templates for proactive messages; business verification [U] |
| Telegram | Dev/demo channel | BotFather token | Free [U] | Lower farmer reach |
| Public HTTPS host | Webhook URLs | Yes | n/a | Dev: tunnel (ngrok/cloudflared); prod: EU host |

## Risks and gotchas

1. FR number type vs automated outbound (above). Biggest unknown; ask Twilio support or choose a French SIP carrier. 
2. FR calling consent: automated/AI calls to farmers need opt-in; GDPR for call recordings and transcripts (disable recording or state it in firstMessage) [U legal; check with counsel].
3. VAPI tool timeout/retry behaviour for server `tool-calls` not confirmed in the pages read; test with a deliberately slow endpoint [U].
4. Voice LLM may paraphrase numbers wrong: return the exact sentence with mm values and instruct "read the report verbatim"; numbers never come from the LLM.
5. VAPI credential only attached for org-config URLs, not inline overrides (orgs created after 2026-09-23, phased) [V]: set server URL on saved tools/assistant.
6. Telegram/Meta retry on slow responses: ack immediately and process async (as above); dedupe by update/message id [U].
7. WhatsApp sandbox sessions expire after 3 days and cap at 1 msg/3 s [V]; not for pilots.
8. Mastra version 1.78.0: snippets above are from current main docs via Context7; verify `registerApiRoute` import path and `agent.generate` memory options against 1.78.0 types [U].
9. Mastra packages on Deno (`@mastra/voice-*`, `@mastra/mcp`) not verified; WebSocket-heavy realtime voice is the riskiest [U].

## Sources

- Mastra docs via Context7 (/mastra-ai/mastra): custom API routes, Hono adapter, working memory (thread/resource), MCPServer/MCPClient reference, voice reference, `chatRoute`/`handleChatStream` (@mastra/ai-sdk) reference. https://github.com/mastra-ai/mastra
- https://mastra.ai/docs/voice/overview
- https://docs.vapi.ai/server-url/events.md ; https://docs.vapi.ai/tools/custom-tools ; https://docs.vapi.ai/server-url/server-authentication.md
- https://docs.vapi.ai/customization/custom-llm/using-your-server ; https://docs.vapi.ai/customization/tool-calling-integration.md
- https://docs.vapi.ai/tools/mcp ; https://docs.vapi.ai/api-reference/tools/create
- https://docs.vapi.ai/calls/outbound-calling ; https://docs.vapi.ai/phone-numbers/import-twilio ; https://docs.vapi.ai/free-telephony.md (title only)
- https://docs.vapi.ai/providers/transcriber/deepgram.md ; https://docs.vapi.ai/providers/voice/elevenlabs.md ; https://vapi.ai/pricing
- https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account ; https://www.twilio.com/en-us/guidelines/fr/regulatory ; https://www.twilio.com/docs/whatsapp/sandbox
- https://developers.facebook.com/docs/whatsapp/cloud-api/get-started ; https://developers.facebook.com/docs/whatsapp/pricing
- https://core.telegram.org/bots/api#setwebhook
