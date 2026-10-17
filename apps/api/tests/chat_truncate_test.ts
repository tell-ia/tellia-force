import { assert, assertEquals } from "@std/assert";
import { newThreadId, TruncateChatThreadResultSchema } from "@tellia/shared/app";
import { scriptedModel } from "./helpers/scriptedModel.ts";
import { makeTestChatApp } from "./helpers/testApp.ts";
import { confirmationRunIds, fromMessage } from "../src/modules/chat/truncate.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };

type App = { request: (u: string, i?: RequestInit) => Response | Promise<Response> };
type Msg = { id: string; role: string; parts: { type: string; text?: string; output?: unknown }[] };

const T1 = newThreadId(1, "edit-1111");
const T2 = newThreadId(2, "edit-2222");

const user = (id: string, text: string): Msg => ({ id, role: "user", parts: [{ type: "text", text }] });

const post = (app: App, member: number, threadId: string, messages: Msg[], extra = {}) =>
  app.request("/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-member-id": String(member), "x-thread-id": threadId },
    body: JSON.stringify({ messages, ...extra }),
  });

const say = async (app: App, member: number, threadId: string, messages: Msg[], extra = {}) => {
  const res = await post(app, member, threadId, messages, extra);
  assertEquals(res.status, 200);
  await res.text();
  await new Promise((r) => setTimeout(r, 25));
};

const history = async (app: App, member: number, threadId: string): Promise<Msg[]> => {
  const res = await app.request("/chat/history", {
    headers: { "x-member-id": String(member), "x-thread-id": threadId },
  });
  assertEquals(res.status, 200);
  return (await res.json()).data.messages;
};

const truncate = (app: App, member: number, pathThread: string, fromMessageId: string) =>
  app.request(`/chat/threads/${pathThread}/truncate`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-member-id": String(member) },
    body: JSON.stringify({ fromMessageId }),
  });

const texts = (ms: Msg[]) => ms.map((m) => m.parts.find((p) => p.type === "text")?.text);

Deno.test("pure: fromMessage keeps the message and everything after it", () => {
  const ms = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assertEquals(fromMessage(ms, "b"), [{ id: "b" }, { id: "c" }]);
  assertEquals(fromMessage(ms, "a"), ms);
  assertEquals(fromMessage(ms, "zzz"), null);
});

Deno.test("pure: confirmationRunIds reads confirmation cards only", () => {
  const ids = confirmationRunIds([
    { parts: [{ type: "text" }, { type: "tool-recordIrrigation", output: { runId: "r1" } }] },
    { parts: [{ type: "tool-correctIrrigation", output: { runId: "r2" } }, { type: "tool-recordIrrigation" }] },
    { parts: [{ type: "tool-confirmIrrigation", output: { runId: "r3" } }] },
    { parts: [{ type: "tool-recordIrrigation", output: { runId: "r1" } }] },
  ]);
  assertEquals(ids, ["r1", "r2"]);
});

Deno.test("truncate: memory keeps the client message ids, and the cut drops the message and all after", opts, async () => {
  const { app } = await makeTestChatApp({ model: scriptedModel([{ text: "A1" }, { text: "A2" }, { text: "A3" }]) });
  await say(app, 1, T1, [user("m1", "Q1")]);
  await say(app, 1, T1, [user("m2", "Q2")]);
  const before = await history(app, 1, T1);
  assertEquals(before.length, 4);
  // The ids the client holds after GET /chat/history are the ids it sent: the server finds them.
  assertEquals(before.filter((m) => m.role === "user").map((m) => m.id), ["m1", "m2"]);

  const res = await truncate(app, 1, T1, "m2");
  assertEquals(res.status, 200);
  const body = TruncateChatThreadResultSchema.parse((await res.json()).data);
  assertEquals(body, { threadId: T1, removed: 2, cancelledRuns: 0 });
  const after = await history(app, 1, T1);
  assertEquals(texts(after), ["Q1", "A1"]);

  // The web resends the whole list with the edited text under the same id: no duplicates.
  // useChat adds id, trigger and messageId to the body: they must not trip the route.
  await say(app, 1, T1, [after[0], after[1], user("m2", "Q2 edited")], { id: "chat-1", trigger: "submit-message", messageId: "m2" });
  assertEquals(texts(await history(app, 1, T1)), ["Q1", "A1", "Q2 edited", "A3"]);
});

Deno.test("truncate: from the first message empties the thread", opts, async () => {
  const { app } = await makeTestChatApp({ model: scriptedModel([]) });
  await say(app, 1, T1, [user("m1", "Q1")]);
  await say(app, 1, T1, [user("m2", "Q2")]);
  const res = await truncate(app, 1, T1, "m1");
  assertEquals((await res.json()).data.removed, 4);
  assertEquals(await history(app, 1, T1), []);
});

Deno.test("truncate: an unknown message or thread is 404, an assistant message is 400", opts, async () => {
  const { app } = await makeTestChatApp({ model: scriptedModel([]) });
  await say(app, 1, T1, [user("m1", "Q1")]);
  const unknown = await truncate(app, 1, T1, "nope");
  assertEquals(unknown.status, 404);
  assertEquals((await unknown.json()).error.code, "http_404");
  assertEquals((await truncate(app, 1, newThreadId(1, "never-created"), "m1")).status, 404);
  const assistantId = (await history(app, 1, T1)).find((m) => m.role === "assistant")!.id;
  assertEquals((await truncate(app, 1, T1, assistantId)).status, 400);
  assertEquals((await history(app, 1, T1)).length, 2); // nothing was removed
  const bad = await app.request(`/chat/threads/${T1}/truncate`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-member-id": "1" },
    body: JSON.stringify({}),
  });
  assertEquals(bad.status, 400);
});

Deno.test("truncate: another member's thread and forged ids are 403 and nothing is removed", opts, async () => {
  const { app, mastra } = await makeTestChatApp({ model: scriptedModel([]) });
  await say(app, 2, T2, [user("b1", "Q of member 2")]);
  const foreign = await truncate(app, 1, T2, "b1");
  assertEquals(foreign.status, 403);
  assertEquals((await foreign.json()).error.code, "http_403");
  for (const id of ["abc", "member-2-xyz", "member-11-xyz", "member-1-", "member-1-a%2Fb"]) {
    assertEquals((await truncate(app, 1, id, "b1")).status, 403, id);
  }
  // A prefixed id stored under another resource is refused too.
  const memory = await mastra.getAgentById("advisor").getMemory();
  const forged = newThreadId(1, "forged");
  await memory!.saveThread({
    thread: { id: forged, resourceId: "member-2", title: "x", createdAt: new Date(), updatedAt: new Date(), metadata: {} },
  });
  assertEquals((await truncate(app, 1, forged, "b1")).status, 403);
  assertEquals((await history(app, 2, T2)).length, 2);
});

Deno.test("truncate: an unanswered confirmation card in the cut is cancelled like a No (draft deleted)", opts, async () => {
  const model = scriptedModel([
    { text: "Hello." },
    { toolCalls: [{ name: "recordIrrigation", input: { fieldId: 10, date: "2026-07-04", mm: 20 } }] },
    { text: "Confirm 20 mm?" },
  ]);
  const { app, data } = await makeTestChatApp({ model });
  const drafts = async () =>
    (await data.listIrrigations(10, { includeDrafts: true })).filter((o) => o.mm === 20);
  await say(app, 1, T1, [user("m1", "Hi")]);
  await say(app, 1, T1, [user("m2", "I watered La Vallee 20 mm yesterday")]);
  assertEquals((await drafts()).map((o) => o.status), ["draft"]);
  const res = await truncate(app, 1, T1, "m2");
  assertEquals((await res.json()).data.cancelledRuns, 1);
  assertEquals((await drafts()).length, 0);
  assertEquals(texts(await history(app, 1, T1)), ["Hi", "Hello."]);
});

Deno.test("truncate: an already confirmed irrigation stays saved, nothing to cancel", opts, async () => {
  const runIdFrom = (prompt: unknown[]) => {
    const m = JSON.stringify(prompt).match(/runId\\?":\\?"([0-9a-f-]{8,})/);
    assert(m, "runId not found in the prompt");
    return { runId: m[1], confirmed: true };
  };
  const model = scriptedModel([
    { toolCalls: [{ name: "recordIrrigation", input: { fieldId: 10, date: "2026-07-04", mm: 20 } }] },
    { text: "Confirm 20 mm?" },
    { toolCalls: [{ name: "confirmIrrigation", input: runIdFrom }] },
    { text: "Saved." },
  ]);
  const { app, data } = await makeTestChatApp({ model });
  await say(app, 1, T1, [user("m1", "I watered La Vallee 20 mm yesterday")]);
  await say(app, 1, T1, [user("m2", "Yes")]);
  const rows = async () => (await data.listIrrigations(10, { includeDrafts: true })).filter((o) => o.mm === 20);
  assertEquals((await rows()).map((o) => o.status), ["confirmed"]);
  const res = await truncate(app, 1, T1, "m1");
  assertEquals((await res.json()).data.cancelledRuns, 0);
  assertEquals((await rows()).map((o) => o.status), ["confirmed"]); // the edit does not undo it
});
