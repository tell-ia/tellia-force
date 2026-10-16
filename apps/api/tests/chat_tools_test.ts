import { assert, assertEquals, assertRejects } from "@std/assert";
import { RequestContext } from "@mastra/core/request-context";
import { createAdvisorTools } from "../src/modules/chat/tools.ts";
import { FARM_ID_KEY, MEMBER_ID_KEY } from "../src/modules/chat/requestContext.ts";
import { makeTestMastra, makeTestRegistry } from "./helpers/testApp.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };

async function setup() {
  const registry = makeTestRegistry();
  const { data, service } = await registry.forFarm(1);
  const mastra = await makeTestMastra({ registry });
  const tools = createAdvisorTools(registry);
  /** A request context as the member middleware builds it: the member and their farm. */
  const ctx = async (member?: number, farm?: number) => {
    const requestContext = new RequestContext();
    if (member !== undefined) {
      requestContext.set(MEMBER_ID_KEY, member);
      const scope = await registry.forMember(member);
      requestContext.set(FARM_ID_KEY, farm ?? scope?.farmId ?? 1);
    }
    return { requestContext, mastra };
  };
  const run = async (
    // deno-lint-ignore no-explicit-any
    tool: { execute?: any },
    input: unknown,
    member?: number,
    farm?: number,
    // deno-lint-ignore no-explicit-any
  ): Promise<any> => tool.execute!(input, await ctx(member, farm));
  return { registry, data, service, tools, run };
}

Deno.test("tool keys are exactly the UI contract", opts, async () => {
  const { tools } = await setup();
  assertEquals(
    Object.keys(tools).sort(),
    [
      "confirmIrrigation",
      "getFarmAdvice",
      "getFieldReport",
      "getIrrigationHistory",
      "getWeather",
      "recordIrrigation",
      "resolveField",
      "simulateScenario",
    ],
  );
  assertEquals(tools.recordIrrigation.id, "record_irrigation");
  assertEquals(tools.getIrrigationHistory.id, "get_irrigation_history");
});

Deno.test("getIrrigationHistory: the fixture's 30 mm record on 2026-06-21", opts, async () => {
  const { tools, run } = await setup();
  const out = await run(tools.getIrrigationHistory, { fieldId: 10 }, 1);
  assertEquals(out.fieldId, 10);
  const rec = out.records.find((r: { date: string }) => r.date === "2026-06-21");
  assert(rec);
  assertEquals(rec.mm, 30);
});

Deno.test("resolveField: la vallée gives field 10 first", opts, async () => {
  const { tools, run } = await setup();
  const out = await run(tools.resolveField, { query: "la vallée" }, 1);
  assertEquals(out.matches[0].fieldId, 10);
});

Deno.test("getFieldReport: report, unknown field rejects, no member rejects", opts, async () => {
  const { tools, run } = await setup();
  const r = await run(tools.getFieldReport, { fieldId: 10 }, 1);
  assertEquals(r.fieldId, 10);
  await assertRejects(() => run(tools.getFieldReport, { fieldId: 999 }, 1));
  await assertRejects(() => run(tools.getFieldReport, { fieldId: 10 }), Error, "member");
});

Deno.test("getWeather returns 7 days around the date", opts, async () => {
  const { tools, run } = await setup();
  const out = await run(tools.getWeather, { fieldId: 10 }, 1);
  assertEquals(out.days.length, 7);
});

Deno.test("getFarmAdvice: 3 reports via the workflow", opts, async () => {
  const { tools, run } = await setup();
  const out = await run(tools.getFarmAdvice, {}, 1);
  assertEquals(out.reports.length, 3);
});

Deno.test("simulateScenario: comparison; empty events is an error object", opts, async () => {
  const { tools, run } = await setup();
  const out = await run(
    tools.simulateScenario,
    { fieldId: 10, events: [{ type: "rain", date: "2026-07-06", mm: 50 }] },
    1,
  );
  assert(out.comparison);
  const bad = await run(tools.simulateScenario, { fieldId: 10, events: [] }, 1);
  assertEquals(bad.error, true);
});

Deno.test("recordIrrigation then confirmIrrigation saves", opts, async () => {
  const { data, tools, run } = await setup();
  const started = await run(tools.recordIrrigation, { fieldId: 10, date: "2026-07-04", mm: 25 }, 1);
  assertEquals(started.status, "awaiting_confirmation");
  assert(started.runId);
  assertEquals(started.summary, "Record 25 mm on La Vallée for 2026-07-04?");
  assertEquals(started.fieldName, "La Vallée");
  const ops = () => data.listIrrigations(10, { includeDrafts: true });
  assertEquals((await ops()).filter((o) => o.status === "draft").length, 1);
  const done = await run(tools.confirmIrrigation, { runId: started.runId, confirmed: true }, 1);
  assertEquals(done.status, "saved");
  assertEquals(done.record.status, "confirmed");
  assertEquals((await ops()).filter((o) => o.status === "draft").length, 0);
});

Deno.test("confirmIrrigation false cancels and deletes the draft", opts, async () => {
  const { data, tools, run } = await setup();
  const started = await run(tools.recordIrrigation, { fieldId: 10, date: "2026-07-04", mm: 25 }, 1);
  const done = await run(tools.confirmIrrigation, { runId: started.runId, confirmed: false }, 1);
  assertEquals(done.status, "cancelled");
  assertEquals(
    (await data.listIrrigations(10, { includeDrafts: true })).filter((o) => o.mm === 25).length,
    0,
  );
});

Deno.test("confirmIrrigation from another member rejects and confirms nothing", opts, async () => {
  const { data, tools, run } = await setup();
  const started = await run(tools.recordIrrigation, { fieldId: 10, date: "2026-07-04", mm: 25 }, 1);
  await assertRejects(() =>
    run(tools.confirmIrrigation, { runId: started.runId, confirmed: true }, 2)
  );
  const mine = (await data.listIrrigations(10, { includeDrafts: true })).filter((o) => o.mm === 25);
  assertEquals(mine.map((o) => o.status), ["draft"]);
  // The run stayed suspended: the owner can still confirm, exactly once.
  const done = await run(tools.confirmIrrigation, { runId: started.runId, confirmed: true }, 1);
  assertEquals(done.status, "saved");
  const after = (await data.listIrrigations(10, { includeDrafts: true })).filter((o) =>
    o.mm === 25
  );
  assertEquals(after.map((o) => o.status), ["confirmed"]);
  // Answering again is refused and adds nothing.
  await assertRejects(() =>
    run(tools.confirmIrrigation, { runId: started.runId, confirmed: true }, 1)
  );
  assertEquals(
    (await data.listIrrigations(10, { includeDrafts: true })).filter((o) => o.mm === 25).length,
    1,
  );
});

Deno.test("confirmIrrigation with an unknown runId rejects", opts, async () => {
  const { tools, run } = await setup();
  await assertRejects(
    () => run(tools.confirmIrrigation, { runId: "nope", confirmed: true }, 1),
    Error,
    "unknown confirmation",
  );
});

Deno.test("record/confirm reject without a member in the request context", opts, async () => {
  const { tools, run } = await setup();
  await assertRejects(
    () => run(tools.recordIrrigation, { fieldId: 10, date: "2026-07-04", mm: 25 }),
    Error,
    "member",
  );
  await assertRejects(
    () => run(tools.confirmIrrigation, { runId: "x", confirmed: true }),
    Error,
    "member",
  );
});

Deno.test("the member id is never a tool input", opts, async () => {
  const { tools } = await setup();
  for (const [key, tool] of Object.entries(tools)) {
    const shape = JSON.stringify(
      // deno-lint-ignore no-explicit-any
      (tool.inputSchema as any)?.toJSONSchema?.() ?? (tool.inputSchema as any)?.shape ?? {},
    );
    assert(!/member/i.test(shape), `${key} exposes a member input`);
  }
});

Deno.test("recordIrrigation records the caller's member id on the draft", opts, async () => {
  const { data, tools, run } = await setup();
  await run(tools.recordIrrigation, { fieldId: 10, date: "2026-07-04", mm: 25 }, 2);
  const draft = (await data.listIrrigations(10, { includeDrafts: true })).find((o) =>
    o.status === "draft"
  );
  assertEquals(draft?.memberId, 2);
});

Deno.test("tools: a farm 2 member sees farm 2 only", opts, async () => {
  const { tools, run } = await setup();
  const found = await run(tools.resolveField, { query: "la vallée" }, 5);
  assertEquals(found.matches.map((m: { fieldId: number }) => m.fieldId), []);
  const maiz = await run(tools.resolveField, { query: "maíz" }, 5);
  assertEquals(maiz.matches[0].fieldId, 15);
  await assertRejects(() => run(tools.getFieldReport, { fieldId: 10 }, 5));
  const advice = await run(tools.getFarmAdvice, {}, 5);
  assertEquals(advice.reports.map((r: { fieldId: number }) => r.fieldId), [15]);
});

Deno.test("tools: confirm refuses a run from another farm", opts, async () => {
  const { tools, run, data } = await setup();
  const started = await run(
    tools.recordIrrigation,
    { fieldId: 10, date: "2026-07-04", mm: 20 },
    1,
  );
  // Same member id claimed with a different farm in the context.
  await assertRejects(
    () => run(tools.confirmIrrigation, { runId: started.runId, confirmed: true }, 1, 2),
  );
  const draft = (await data.listIrrigations(10, { includeDrafts: true })).filter((o) =>
    o.mm === 20
  );
  assertEquals(draft.map((o) => o.status), ["draft"]);
});
