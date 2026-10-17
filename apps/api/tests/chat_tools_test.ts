import { assert, assertEquals, assertRejects } from "@std/assert";
import { RequestContext } from "@mastra/core/request-context";
import { z } from "zod";
import { FieldDetailsSchema, FieldJournalSchema, ProductCheckSchema } from "@tellia/shared/farm";
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
      "checkProductUse",
      "confirmIrrigation",
      "getFarmAdvice",
      "getFieldDetails",
      "getFieldJournal",
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
  assertEquals(tools.getFieldDetails.id, "get_field_details");
  assertEquals(tools.getFieldJournal.id, "get_field_journal");
  assertEquals(tools.checkProductUse.id, "check_product_use");
});

Deno.test("tool texts name other tools by key (what the model sees), never by id", opts, async () => {
  const { tools } = await setup();
  const ids = Object.values(tools).map((t) => t.id);
  for (const [key, tool] of Object.entries(tools)) {
    const text = tool.description +
      JSON.stringify(z.toJSONSchema(tool.inputSchema as unknown as z.ZodType));
    for (const id of ids) assert(!text.includes(id), `${key} mentions the tool id ${id}`);
  }
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

Deno.test("getFieldDetails: crop, soil and system of the caller's field", opts, async () => {
  const { tools, run } = await setup();
  const d = FieldDetailsSchema.parse(await run(tools.getFieldDetails, { fieldId: 10 }, 1));
  assertEquals(d.field.name, "La Vallée");
  assertEquals(d.crop?.name, "Maïs");
  assertEquals(d.crop?.previousCropName, "Blé tendre d'hiver");
  assertEquals(d.soil?.textureClass, "Sandy loam");
  assertEquals(d.soil?.ph, 6.4);
  assertEquals(d.irrigationSystem, null);
  await assertRejects(() => run(tools.getFieldDetails, { fieldId: 999 }, 1));
  await assertRejects(() => run(tools.getFieldDetails, { fieldId: 10 }), Error, "member");
});

Deno.test("getFieldJournal: season entries and totals from the server; filters", opts, async () => {
  const { tools, run } = await setup();
  const j = FieldJournalSchema.parse(await run(tools.getFieldJournal, { fieldId: 10 }, 1));
  assertEquals([j.from, j.to], ["2026-04-16", "2026-10-17"]);
  assertEquals(j.entries.length, 8);
  assertEquals(j.entries[0].planned, true);
  assertEquals(
    [j.totals.nKgHa, j.totals.p2o5KgHa, j.totals.k2oKgHa, j.totals.irrigationMm, j.totals.sprays],
    [110, 40, 60, 30, 2],
  );
  const sprays = await run(tools.getFieldJournal, { fieldId: 10, type: "spraying" }, 1);
  assertEquals(sprays.entries.map((e: { operationId: number }) => e.operationId), [1006, 1005]);
  assertEquals(sprays.entries[1].products.length, 2);
  const farm = await run(tools.getFieldJournal, {}, 1);
  assertEquals(farm.fieldId, null);
  assertEquals(farm.totals.nKgHa, null);
  const bad = await run(tools.getFieldJournal, { fieldId: 10, type: "weeding" }, 1);
  assertEquals(bad.error, true);
  await assertRejects(() => run(tools.getFieldJournal, {}), Error, "member");
});

Deno.test(
  "getFieldDetails / getFieldJournal: a farm 2 member never reads farm 1",
  opts,
  async () => {
    const { tools, run } = await setup();
    await assertRejects(() => run(tools.getFieldDetails, { fieldId: 10 }, 5), Error, "not found");
    await assertRejects(() => run(tools.getFieldJournal, { fieldId: 10 }, 5), Error, "not found");
    const j = await run(tools.getFieldJournal, {}, 5);
    assertEquals(
      [...new Set(j.entries.map((e: { fieldId: number }) => e.fieldId))],
      [15],
    );
    assertEquals(j.totals.nKgHa, 90);
  },
);

Deno.test("checkProductUse: verdict, uses and season count from the server", opts, async () => {
  const { tools, run } = await setup();
  const c = ProductCheckSchema.parse(
    await run(tools.checkProductUse, { product: "Karaté Zeon", fieldId: 10 }, 1),
  );
  assertEquals([c.status, c.product?.name, c.authorised], [
    "found",
    "KARATE AVEC TECHNOLOGIE ZEON",
    true,
  ]);
  assertEquals(c.uses.length, 2);
  assertEquals([c.usage?.timesUsed, c.daysToHarvest, c.preHarvestOk], [1, 104, true]);
  const late = await run(
    tools.checkProductUse,
    { product: "decis", fieldId: 10, date: "2026-09-18" },
    1,
  );
  assertEquals([late.preHarvestOk, late.applicationsLeft], [false, 3]);
  const several = await run(tools.checkProductUse, { product: "karate", fieldId: 10 }, 1);
  assertEquals([several.status, several.authorised, several.matches.length], ["ambiguous", null, 2]);
  const bad = await run(tools.checkProductUse, { product: "", fieldId: 10 }, 1);
  assertEquals(bad.error, true);
  await assertRejects(
    () => run(tools.checkProductUse, { product: "decis", fieldId: 10 }),
    Error,
    "member",
  );
});

Deno.test("checkProductUse: a farm 2 member never reads farm 1", opts, async () => {
  const { tools, run } = await setup();
  await assertRejects(
    () => run(tools.checkProductUse, { product: "decis", fieldId: 10 }, 5),
    Error,
    "not found",
  );
  const c = await run(tools.checkProductUse, { product: "AS-HER-07", fieldId: 15 }, 5);
  assertEquals([c.status, c.product.synthetic, c.authorised, c.usage.timesUsed], [
    "found",
    true,
    null,
    1,
  ]);
  assert(c.warnings[0].includes("E-Phy covers France only"));
  const fromFarm1 = await run(tools.checkProductUse, { product: "AS-HER-07", fieldId: 10 }, 1);
  assertEquals(fromFarm1.status, "not_found");
});
