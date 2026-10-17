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

/** Every finite number anywhere in a value (recursive; null/undefined skipped). */
export function numbersIn(v: unknown, acc: number[] = []): number[] {
  if (typeof v === "number") {
    if (Number.isFinite(v)) acc.push(v);
  } else if (Array.isArray(v)) {
    for (const x of v) numbersIn(x, acc);
  } else if (v !== null && v !== undefined && typeof v === "object") {
    for (const x of Object.values(v)) numbersIn(x, acc);
  }
  return acc;
}

/** A number as written in a reply: "6,4", "12.5", "22 400" (space, nbsp or narrow nbsp). */
const NUMBER = String.raw`(?<![\d.,])(\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)`;

/** What a written number can mean: "22.400" may be 22.4 or 22 400. */
function readings(raw: string): number[] {
  const compact = raw.replace(/[   ]/g, "");
  const out = [Number(compact.replace(",", "."))];
  if (/^\d{1,3}([.,]\d{3})+$/.test(compact)) out.push(Number(compact.replace(/[.,]/g, "")));
  return out.filter(Number.isFinite);
}

/**
 * Every number written just before `unit` (a regex source, case-insensitive) must equal a
 * number in `allowed` (±tol). Returns the numbers found and the ungrounded ones.
 */
export function grounded(text: string, unit: string, allowed: number[], tol = 0.5) {
  const found: string[] = [];
  const bad: string[] = [];
  for (const m of text.matchAll(new RegExp(`${NUMBER}\\s*(?:${unit})`, "gi"))) {
    found.push(m[1]);
    const ok = readings(m[1]).some((n) => allowed.some((a) => Math.abs(a - n) <= tol));
    if (!ok) bad.push(m[1]);
  }
  return { found, bad };
}

/** Runs a turn, retrying once when `ok` fails (the model skipped a tool); logs the retry. */
export async function turnWithRetry(
  label: string,
  run: () => Promise<ChatTurn>,
  ok: (t: ChatTurn) => boolean,
  /** Undo the first attempt's side effects so the retry is idempotent. */
  beforeRetry?: () => Promise<void>,
): Promise<ChatTurn> {
  const first = await run();
  if (ok(first)) return first;
  const calls = first.toolCalls.map((c) => `${c.name}(${JSON.stringify(c.input)})`);
  console.log(
    `[live] RETRY ${label}: first attempt tools=[${calls.join(", ")}] text=${
      first.text.slice(0, 300)
    }`,
  );
  await beforeRetry?.();
  return await run();
}
