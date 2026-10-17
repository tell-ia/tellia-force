import { assert, assertEquals } from "@std/assert";
import { ChatThreadListSchema, newThreadId } from "@tellia/shared/app";
import { scriptedModel } from "./helpers/scriptedModel.ts";
import { makeTestChatApp } from "./helpers/testApp.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };

type App = { request: (u: string, i?: RequestInit) => Response | Promise<Response> };

const A1 = newThreadId(1, "aaaa-1111");
const A2 = newThreadId(1, "bbbb-2222");
const B1 = newThreadId(2, "cccc-3333");

const post = (app: App, member: number, threadId?: string) =>
  app.request("/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-member-id": String(member),
      ...(threadId ? { "x-thread-id": threadId } : {}),
    },
    body: JSON.stringify({
      messages: [{ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: "Hello" }] }],
    }),
  });

const get = (app: App, path: string, member: number, threadId?: string) =>
  app.request(path, {
    headers: {
      "x-member-id": String(member),
      ...(threadId ? { "x-thread-id": threadId } : {}),
    },
  });

const send = async (app: App, member: number, threadId?: string) => {
  const res = await post(app, member, threadId);
  assertEquals(res.status, 200);
  await res.text();
  await new Promise((r) => setTimeout(r, 25)); // distinct updatedAt
};

const threadsOf = async (app: App, member: number) => {
  const res = await get(app, "/chat/threads", member);
  assertEquals(res.status, 200);
  return ChatThreadListSchema.parse((await res.json()).data);
};

Deno.test("threads: empty before any chat", opts, async () => {
  const { app } = await makeTestChatApp({ model: scriptedModel([]) });
  assertEquals(await threadsOf(app, 1), []);
});

Deno.test("threads: scoped to the member, newest updated first", opts, async () => {
  const { app } = await makeTestChatApp({ model: scriptedModel([]) });
  await send(app, 1, A1);
  await send(app, 1, A2);
  await send(app, 2, B1);
  assertEquals((await threadsOf(app, 1)).map((t) => t.id), [A2, A1]);
  assertEquals((await threadsOf(app, 2)).map((t) => t.id), [B1]);
  // A new message in the older thread moves it to the top.
  await send(app, 1, A1);
  const list = await threadsOf(app, 1);
  assertEquals(list.map((t) => t.id), [A1, A2]);
  assert(list[0].updatedAt > list[1].updatedAt);
  assertEquals(list[0].title, null); // no title model offline: null, not an empty string
  assertEquals((await get(app, "/chat/threads", 999)).status, 400);
});

Deno.test("threads: history follows the x-thread-id header", opts, async () => {
  const { app } = await makeTestChatApp({ model: scriptedModel([]) });
  await send(app, 1, A1);
  const one = await (await get(app, "/chat/history", 1, A1)).json();
  assertEquals(one.data.threadId, A1);
  assertEquals(one.data.messages.length, 2);
  // A thread that does not exist yet is empty, not an error (created lazily).
  const fresh = await (await get(app, "/chat/history", 1, A2)).json();
  assertEquals(fresh.data, { threadId: A2, messages: [] });
  assertEquals((await threadsOf(app, 1)).map((t) => t.id), [A1]); // reading creates nothing
});

Deno.test("threads: member A cannot read or post into member B's thread", opts, async () => {
  const { app } = await makeTestChatApp({ model: scriptedModel([]) });
  await send(app, 2, B1);
  // The id carries member 2's prefix, so member 1 is refused by prefix.
  for (const res of [await get(app, "/chat/history", 1, B1), await post(app, 1, B1)]) {
    assertEquals(res.status, 403);
    assertEquals((await res.json()).error.code, "http_403");
  }
  assertEquals((await threadsOf(app, 2)).length, 1);
  assertEquals((await threadsOf(app, 1)).length, 0);
});

Deno.test("threads: a prefixed id owned by another resource is refused", opts, async () => {
  const { app, mastra } = await makeTestChatApp({ model: scriptedModel([]) });
  // Forge a thread under member 1's prefix but stored for member 2.
  const memory = await mastra.getAgentById("advisor").getMemory();
  const forged = newThreadId(1, "forged");
  await memory!.saveThread({
    thread: {
      id: forged,
      resourceId: "member-2",
      title: "x",
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
    },
  });
  assertEquals((await get(app, "/chat/history", 1, forged)).status, 403);
  assertEquals((await post(app, 1, forged)).status, 403);
});

Deno.test("threads: forged or malformed ids are 403", opts, async () => {
  const { app } = await makeTestChatApp({ model: scriptedModel([]) });
  const ids = ["abc", "member-2-xyz", "member-11-xyz", "member-1-", "member-1-a/b", `member-1-${"x".repeat(80)}`];
  for (const id of ids) {
    assertEquals((await get(app, "/chat/history", 1, id)).status, 403, id);
    assertEquals((await post(app, 1, id)).status, 403, id);
  }
});

Deno.test("threads: no header falls back to the latest thread, else the day thread", opts, async () => {
  const { app } = await makeTestChatApp({ model: scriptedModel([]) });
  const none = await (await get(app, "/chat/history", 1)).json();
  assertEquals(none.data.threadId, "member-1-2026-07-05");
  await send(app, 1, A1);
  await send(app, 1, A2);
  assertEquals((await (await get(app, "/chat/history", 1)).json()).data.threadId, A2);
  // POST without the header lands in that same thread, no new one is created.
  await send(app, 1);
  assertEquals((await threadsOf(app, 1)).map((t) => t.id), [A2, A1]);
  assertEquals((await (await get(app, "/chat/history", 1)).json()).data.messages.length, 4);
  // Member 2 is unaffected.
  assertEquals((await (await get(app, "/chat/history", 2)).json()).data.threadId, "member-2-2026-07-05");
});

Deno.test("threads: CORS allows x-thread-id", opts, async () => {
  const { app } = await makeTestChatApp({ model: scriptedModel([]) });
  const res = await app.request("/chat", {
    method: "OPTIONS",
    headers: {
      origin: "http://localhost:5173",
      "access-control-request-method": "POST",
      "access-control-request-headers": "x-thread-id",
    },
  });
  assert((res.headers.get("access-control-allow-headers") ?? "").toLowerCase().includes("x-thread-id"));
});

Deno.test("threads: history returns the whole thread, not the agent's lastMessages window", opts, async () => {
  const { app } = await makeTestChatApp({ model: scriptedModel([]) });
  // 7 turns = 14 messages: more than the advisor's lastMessages (10), which only caps the
  // model's context, never what the farmer can scroll back to.
  for (let i = 0; i < 7; i++) await send(app, 1, A1);
  const { data } = await (await get(app, "/chat/history", 1, A1)).json();
  assertEquals(data.messages.length, 14);
  assertEquals(data.messages[0].role, "user");
});
