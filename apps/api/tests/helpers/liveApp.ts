// Live-test helpers: the full chat app on the in-memory farm with the REAL model.
// Never touches Supabase (in-memory FarmData, fixture weather).

import { makeTestChatApp } from "./testApp.ts";

export const LIVE = Deno.env.get("RUN_LIVE_TESTS") === "1";
export const DB_TESTS = Deno.env.get("RUN_DB_TESTS") === "1";
export const liveModel = () => Deno.env.get("MODEL") ?? "openai/gpt-6.1-sol";

/** The test app wired to the real model string (key from OPENAI_API_KEY). */
export const makeLiveApp = () => makeTestChatApp({ model: liveModel() });

export interface ToolCall {
  name: string;
  // deno-lint-ignore no-explicit-any
  input: any;
  // deno-lint-ignore no-explicit-any
  output: any;
}

export interface ChatTurn {
  toolCalls: ToolCall[];
  text: string;
  msFirstText: number;
  msTotal: number;
}

type Requester = { request: (u: string, i?: RequestInit) => Response | Promise<Response> };

/** Parses an AI SDK v7 UI-message SSE body into tool calls and text. */
export function parseSse(raw: string): Pick<ChatTurn, "toolCalls" | "text"> {
  const calls = new Map<string, ToolCall>();
  let text = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    // deno-lint-ignore no-explicit-any
    let ev: any;
    try {
      ev = JSON.parse(payload);
    } catch {
      continue;
    }
    if (ev.type === "tool-input-available" || ev.type === "tool-input-start") {
      const c = calls.get(ev.toolCallId) ??
        { name: ev.toolName, input: undefined, output: undefined };
      if (ev.input !== undefined) c.input = ev.input;
      calls.set(ev.toolCallId, c);
    } else if (ev.type === "tool-output-available") {
      const c = calls.get(ev.toolCallId) ?? { name: "?", input: undefined, output: undefined };
      c.output = ev.output;
      calls.set(ev.toolCallId, c);
    } else if (ev.type === "text-delta") text += ev.delta ?? "";
  }
  return { toolCalls: [...calls.values()], text };
}

/** Posts one user message to /chat as `memberId` and reads the whole stream. */
export async function chatTurn(
  app: Requester,
  message: string,
  memberId = 1,
): Promise<ChatTurn> {
  const t0 = performance.now();
  const res = await app.request("/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-member-id": String(memberId) },
    body: JSON.stringify({
      messages: [{
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: message }],
      }],
    }),
  });
  if (res.status !== 200) throw new Error(`/chat ${res.status}: ${await res.text()}`);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let raw = "";
  let msFirstText = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += dec.decode(value, { stream: true });
    if (!msFirstText && /"type":"text-delta"/.test(raw)) msFirstText = performance.now() - t0;
  }
  return { ...parseSse(raw), msFirstText, msTotal: performance.now() - t0 };
}

/** Runs a turn, retrying once when `ok` fails (the model skipped a tool); logs the retry. */
export async function turnWithRetry(
  label: string,
  run: () => Promise<ChatTurn>,
  ok: (t: ChatTurn) => boolean,
): Promise<ChatTurn> {
  const first = await run();
  if (ok(first)) return first;
  console.log(`[live] RETRY ${label}: tools were ${first.toolCalls.map((c) => c.name)}`);
  return await run();
}
