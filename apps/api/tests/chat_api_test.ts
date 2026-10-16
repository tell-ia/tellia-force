import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { scriptedModel } from "./helpers/scriptedModel.ts";
import { makeTestChatApp } from "./helpers/testApp.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };

const script = () => [
  { toolCalls: [{ name: "getFarmAdvice", input: {} }] },
  { text: "Arrosez La Vallée : 90 mm." },
];

const body = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    messages: [{
      id: "m1",
      role: "user",
      parts: [{ type: "text", text: "Quel champ arroser ?" }],
    }],
    ...extra,
  });

const post = (
  app: { request: (u: string, i?: RequestInit) => Response | Promise<Response> },
  headers: Record<string, string>,
  extra?: Record<string, unknown>,
) =>
  app.request("/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body(extra),
  });

Deno.test("CORS preflight on /chat allows x-member-id and content-type", opts, async () => {
  const { app } = await makeTestChatApp({ model: scriptedModel([]) });
  const res = await app.request("/chat", {
    method: "OPTIONS",
    headers: {
      origin: "http://localhost:5173",
      "access-control-request-method": "POST",
      "access-control-request-headers": "x-member-id,content-type",
    },
  });
  assert(res.status === 204 || res.status === 200);
  const allowed = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
  assertStringIncludes(allowed, "x-member-id");
  assertStringIncludes(allowed, "content-type");
});

Deno.test("POST /chat with an unknown member is 400", opts, async () => {
  const { app } = await makeTestChatApp({ model: scriptedModel([]) });
  const res = await post(app, { "x-member-id": "999" });
  assertEquals(res.status, 400);
  const j = await res.json();
  assertEquals(j.error.code, "http_400");
});

Deno.test("chat ignores client-supplied memory ids", opts, async () => {
  const { app, mastra } = await makeTestChatApp({ model: scriptedModel(script()) });
  const res = await post(app, { "x-member-id": "1" }, {
    memory: { resource: "member-2", thread: { id: "stolen" } },
  });
  assertEquals(res.status, 200);
  const sse = await res.text();
  assertStringIncludes(sse, "tool-output-available");
  assertStringIncludes(sse, '"fieldId":10');
  assertStringIncludes(sse, "Arrosez La Vallée : 90 mm.");
  const memory = await mastra.getAgentById("advisor").getMemory();
  const mine = await memory!.listThreads({ filter: { resourceId: "member-1" } });
  assertEquals(mine.threads.map((t: { id: string }) => t.id), ["member-1-2026-07-05"]);
  const theirs = await memory!.listThreads({ filter: { resourceId: "member-2" } });
  assertEquals(theirs.threads.length, 0);
});

Deno.test("no header: treated as member 1", opts, async () => {
  const { app, mastra } = await makeTestChatApp({ model: scriptedModel(script()) });
  const res = await post(app, {});
  assertEquals(res.status, 200);
  await res.text();
  const memory = await mastra.getAgentById("advisor").getMemory();
  const mine = await memory!.listThreads({ filter: { resourceId: "member-1" } });
  assertEquals(mine.threads.length, 1);
});

Deno.test("history: empty before the first chat, 2 messages after", opts, async () => {
  const { app } = await makeTestChatApp({ model: scriptedModel(script()) });
  const h = { "x-member-id": "1" };
  const empty = await (await app.request("/chat/history", { headers: h })).json();
  assertEquals(empty.data.messages, []);
  assertEquals(empty.data.threadId, "member-1-2026-07-05");
  await (await post(app, h)).text();
  const after = await (await app.request("/chat/history", { headers: h })).json();
  assertEquals(after.data.messages.length, 2);
  const parts = after.data.messages[1].parts.map((p: { type: string }) => p.type);
  assert(parts.includes("tool-getFarmAdvice"), JSON.stringify(parts));
  // Another member sees nothing of it.
  const other = await (await app.request("/chat/history", { headers: { "x-member-id": "2" } }))
    .json();
  assertEquals(other.data.messages, []);
  const bad = await app.request("/chat/history", { headers: { "x-member-id": "999" } });
  assertEquals(bad.status, 400);
});

Deno.test("after startWorkers, the morning-warmup schedule is listed", opts, async () => {
  const { app, mastra } = await makeTestChatApp({
    model: scriptedModel([]),
    openMastraApi: true,
  });
  await mastra.startWorkers();
  try {
    const res = await app.request("/api/schedules", { headers: { "x-member-id": "1" } });
    assertEquals(res.status, 200);
    assertStringIncludes(await res.text(), "wf_morning-warmup");
  } finally {
    await mastra.shutdown();
  }
});

Deno.test("member middleware matches /chat and /chat/..., not /chatter", opts, async () => {
  const { app } = await makeTestChatApp({ model: scriptedModel([]) });
  const h = { "x-member-id": "999" };
  assertEquals((await app.request("/chat", { method: "POST", headers: h })).status, 400);
  const other = await app.request("/chatter", { method: "POST", headers: h });
  assertEquals(other.status, 404);
});

Deno.test(
  "OPEN_MASTRA_API off: /api/* is 404 in the envelope, /chat still works",
  opts,
  async () => {
    const { app } = await makeTestChatApp({ model: scriptedModel(script()) });
    const res = await app.request("/api/agents", { headers: { "x-member-id": "1" } });
    assertEquals(res.status, 404);
    assertEquals((await res.json()).error, { code: "http_404", message: "Mastra API disabled" });
    const wf = await app.request("/api/workflows/record-irrigation/start-async", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assertEquals(wf.status, 404);
    const chat = await post(app, { "x-member-id": "1" });
    assertEquals(chat.status, 200);
    assertStringIncludes(await chat.text(), "Arrosez La Vallée : 90 mm.");
    assertEquals(
      (await app.request("/chat/history", { headers: { "x-member-id": "1" } })).status,
      200,
    );
  },
);

Deno.test("OPEN_MASTRA_API on: /api/agents is 200", opts, async () => {
  const { app } = await makeTestChatApp({ model: scriptedModel([]), openMastraApi: true });
  const res = await app.request("/api/agents", { headers: { "x-member-id": "1" } });
  assertEquals(res.status, 200);
});

Deno.test("chat as a farm 2 member: farm 2 data and memory only", opts, async () => {
  const { app, mastra } = await makeTestChatApp({
    model: scriptedModel([
      { toolCalls: [{ name: "getFarmAdvice", input: {} }] },
      { text: "Riega El Pozo." },
    ]),
  });
  const res = await post(app, { "x-member-id": "5" });
  assertEquals(res.status, 200);
  const sse = await res.text();
  assertStringIncludes(sse, '"fieldId":15');
  assert(!sse.includes('"fieldId":10'), "farm 1 field leaked into farm 2's chat");
  const memory = await mastra.getAgentById("advisor").getMemory();
  const threads = await memory!.listThreads({ filter: { resourceId: "member-5" } });
  assertEquals(threads.threads.map((t: { id: string }) => t.id), ["member-5-2026-07-05"]);
});
