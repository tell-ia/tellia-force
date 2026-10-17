import { assert, assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";
import { RequestContext } from "@mastra/core/request-context";
import type { FarmData } from "../src/modules/irrigation/data/farmData.ts";
import { createMemoryFarmData } from "../src/modules/irrigation/data/memoryFarmData.ts";
import { createAdvisorWorkflows } from "../src/modules/chat/workflows/index.ts";
import { FARM_ID_KEY, MEMBER_ID_KEY } from "../src/modules/chat/requestContext.ts";
import { makeFarmFixture, makeSecondFarmFixture } from "./fixtures/farm.ts";
import { makeReference2022Fixture } from "./fixtures/fao.ts";
import { makeTestMastra, makeTestRegistry } from "./helpers/testApp.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };

/** Members 1-2 are on farm 1, members 5-6 on farm 2 (as the member middleware sets it). */
const farmOf = (memberId: number) => (memberId >= 5 ? 2 : 1);
export const ctxFor = (memberId: number, farmId = farmOf(memberId)) => {
  const rc = new RequestContext();
  rc.set(MEMBER_ID_KEY, memberId);
  rc.set(FARM_ID_KEY, farmId);
  return rc;
};

async function setup() {
  const registry = makeTestRegistry();
  const { data, service } = await registry.forFarm(1);
  const mastra = await makeTestMastra({ registry });
  return { registry, data, service, mastra };
}

const drafts = async (data: FarmData, status?: string) =>
  (await data.listIrrigations(10, { includeDrafts: true })).filter((o) =>
    status ? o.status === status : true
  );

Deno.test("farm-advice: same reports and order as the service", opts, async () => {
  const { service, mastra } = await setup();
  const run = await mastra.getWorkflow("farm-advice").createRun();
  const res = await run.start({ inputData: { farmId: 1 } });
  assertEquals(res.status, "success");
  const expected = await service.getFarmAdvice();
  // deno-lint-ignore no-explicit-any
  assertEquals((res as any).result, expected);
  // deno-lint-ignore no-explicit-any
  assertEquals((res as any).result.reports.length, 3);
});

Deno.test("simulate-scenario: 50 mm of rain gives a comparison", opts, async () => {
  const { mastra } = await setup();
  const run = await mastra.getWorkflow("simulate-scenario").createRun();
  const res = await run.start({
    inputData: { farmId: 1, fieldId: 10, events: [{ type: "rain", date: "2026-07-06", mm: 50 }] },
  });
  assertEquals(res.status, "success");
  // deno-lint-ignore no-explicit-any
  const out = (res as any).result;
  assert(out.comparison);
  assertEquals(out.summary, out.comparison.summary);
});

async function startRecord(mastra: Awaited<ReturnType<typeof setup>>["mastra"], member = 1) {
  const run = await mastra.getWorkflow("record-irrigation").createRun();
  const res = await run.start({
    inputData: { farmId: 1, memberId: member, fieldId: 10, date: "2026-07-04", mm: 25 },
    requestContext: ctxFor(member),
  });
  return { run, res };
}

const resume = async (
  mastra: Awaited<ReturnType<typeof setup>>["mastra"],
  runId: string,
  confirmed: boolean,
  member: number,
) =>
  (await mastra.getWorkflow("record-irrigation").createRun({ runId })).resume({
    step: "confirm",
    resumeData: { confirmed },
    requestContext: ctxFor(member),
  });

Deno.test(
  "record-irrigation: suspends with a draft that does not change the advice",
  opts,
  async () => {
    const { data, service, mastra } = await setup();
    const before = await service.getFieldReport(10);
    const { run, res } = await startRecord(mastra);
    assertEquals(res.status, "suspended");
    // deno-lint-ignore no-explicit-any
    const payload = (res as any).suspendPayload.confirm;
    assertEquals(payload.summary, "Record 25 mm on La Vallée for 2026-07-04?");
    assertEquals(payload.fieldId, 10);
    assertEquals(payload.mm, 25);
    assert(typeof payload.operationId === "number");
    assert(run.runId);
    assertEquals((await drafts(data, "draft")).length, 1);
    assertEquals(await service.getFieldReport(10), before);
  },
);

Deno.test(
  "record-irrigation: resume from a fresh handle as the same member saves",
  opts,
  async () => {
    const { data, service, mastra } = await setup();
    const before = await service.getFieldReport(10);
    const { run } = await startRecord(mastra);
    const res = await resume(mastra, run.runId, true, 1);
    assertEquals(res.status, "success");
    // deno-lint-ignore no-explicit-any
    const out = (res as any).result;
    assertEquals(out.status, "saved");
    assertEquals(out.record.status, "confirmed");
    assertEquals((await drafts(data, "confirmed")).filter((o) => o.mm === 25).length, 1);
    assertNotEquals((await service.getFieldReport(10)).depletionMm, before.depletionMm);
  },
);

Deno.test("record-irrigation: declining deletes the draft", opts, async () => {
  const { data, mastra } = await setup();
  const { run } = await startRecord(mastra);
  const res = await resume(mastra, run.runId, false, 1);
  assertEquals(res.status, "success");
  // deno-lint-ignore no-explicit-any
  assertEquals((res as any).result.status, "cancelled");
  assertEquals((await drafts(data)).filter((o) => o.mm === 25).length, 0);
});

Deno.test(
  "record-irrigation: another member cannot resume; the draft stays a draft",
  opts,
  async () => {
    const { data, mastra } = await setup();
    const { run } = await startRecord(mastra, 1);
    const res = await resume(mastra, run.runId, true, 2);
    assertNotEquals(res.status, "success");
    const ops = (await drafts(data)).filter((o) => o.mm === 25);
    assertEquals(ops.length, 1);
    assertEquals(ops[0].status, "draft");
    // Even a "yes" from the wrong member never confirms anything.
    assertEquals((await drafts(data, "confirmed")).filter((o) => o.mm === 25).length, 0);
    assertEquals(res.status, "failed");
  },
);

Deno.test("record-irrigation: confirming twice leaves one confirmed record", opts, async () => {
  const { data, mastra } = await setup();
  const { run } = await startRecord(mastra);
  await resume(mastra, run.runId, true, 1);
  let second: Awaited<ReturnType<typeof resume>> | undefined;
  try {
    second = await resume(mastra, run.runId, true, 1);
  } catch { /* a rejected second resume is fine */ }
  if (second) {
    // It must not report a second `saved`.
    // deno-lint-ignore no-explicit-any
    assertNotEquals((second as any).result?.status === "saved" && second.status, "success");
  }
  assertEquals((await drafts(data)).filter((o) => o.mm === 25).length, 1);
  assertEquals((await drafts(data, "confirmed")).filter((o) => o.mm === 25).length, 1);
});

Deno.test(
  "record-irrigation: a future date fails at validate and creates no draft",
  opts,
  async () => {
    const { data, mastra } = await setup();
    const run = await mastra.getWorkflow("record-irrigation").createRun();
    const res = await run.start({
      inputData: { farmId: 1, memberId: 1, fieldId: 10, date: "2026-07-06", mm: 25 },
      requestContext: ctxFor(1),
    });
    assertEquals(res.status, "failed");
    // deno-lint-ignore no-explicit-any
    assertStringIncludes(String((res as any).error?.message ?? (res as any).error), "future");
    assertEquals((await drafts(data, "draft")).length, 0);
  },
);

Deno.test(
  "morning-warmup: covers every farm and fills each farm's weather cache",
  opts,
  async () => {
    const reads: Record<number, number> = { 1: 0, 2: 0 };
    const counting = (farmId: number, base: FarmData): FarmData => ({
      ...base,
      getWeather: (from, to) => {
        reads[farmId]++;
        return base.getWeather(from, to);
      },
    });
    const registry = makeTestRegistry({
      farms: {
        1: counting(1, createMemoryFarmData(makeFarmFixture())),
        2: counting(2, createMemoryFarmData(makeSecondFarmFixture())),
      },
    });
    const mastra = await makeTestMastra({ registry });
    const run = await mastra.getWorkflow("morning-warmup").createRun();
    const res = await run.start({ inputData: {} });
    assertEquals(res.status, "success");
    // deno-lint-ignore no-explicit-any
    const out = (res as any).result;
    assertEquals(out.fields, 4); // farm 1: 3 fields, farm 2: 1 field
    assertEquals(out.failures, 0);
    assert(reads[1] > 0 && reads[2] > 0, "both farms warmed");
    const warmed = { ...reads };
    await (await registry.forFarm(1)).service.getFarmAdvice();
    await (await registry.forFarm(2)).service.getFarmAdvice();
    assertEquals(reads, warmed);
  },
);

Deno.test("morning-warmup: declares the 05:00 Europe/Paris schedule", opts, async () => {
  const { mastra } = await setup();
  const schedules = mastra.getWorkflow("morning-warmup").getScheduleConfigs?.() ?? [];
  assertEquals(schedules.length, 1);
  assertEquals(schedules[0].cron, "0 5 * * *");
  assertEquals(schedules[0].timezone, "Europe/Paris");
});

Deno.test("morning-warmup: schedule timezone is configurable", opts, () => {
  const wf = createAdvisorWorkflows(makeTestRegistry(), "America/New_York");
  assertEquals(wf.morningWarmup.getScheduleConfigs?.()[0].timezone, "America/New_York");
});

Deno.test("morning-warmup: every field failing fails the run", opts, async () => {
  const registry = makeTestRegistry({
    wrap: (real) => ({
      ...real,
      getFieldReport: () => Promise.reject(new Error("weather offline")),
    }),
  });
  const mastra = await makeTestMastra({ registry });
  const run = await mastra.getWorkflow("morning-warmup").createRun();
  const res = await run.start({ inputData: {} });
  assertEquals(res.status, "failed");
  // deno-lint-ignore no-explicit-any
  assertStringIncludes(
    String((res as any).error?.message ?? (res as any).error),
    "weather offline",
  );
});

Deno.test(
  "farm-advice: farm 2 sees only its own field, with its own (hotter) weather",
  opts,
  async () => {
    const { registry, mastra } = await setup();
    const run = await mastra.getWorkflow("farm-advice").createRun();
    const res = await run.start({ inputData: { farmId: 2 } });
    assertEquals(res.status, "success");
    // deno-lint-ignore no-explicit-any
    const reports = (res as any).result.reports;
    assertEquals(reports.map((r: { fieldId: number }) => r.fieldId), [15]);
    assertEquals(reports[0].cropName, "Maíz");
    const farm1 = await (await registry.forFarm(1)).service.getFieldReport(10);
    assertNotEquals(reports[0].depletionMm, farm1.depletionMm);
  },
);

Deno.test("record-irrigation: a member of farm 2 cannot write on farm 1", opts, async () => {
  const { data, mastra } = await setup();
  const run = await mastra.getWorkflow("record-irrigation").createRun();
  const res = await run.start({
    inputData: { farmId: 1, memberId: 5, fieldId: 10, date: "2026-07-04", mm: 25 },
    requestContext: ctxFor(5),
  });
  assertEquals(res.status, "failed");
  assertEquals((await drafts(data, "draft")).length, 0);
});

Deno.test("record-irrigation: farm 2 cannot reach a farm 1 field", opts, async () => {
  const { data, mastra } = await setup();
  const run = await mastra.getWorkflow("record-irrigation").createRun();
  const res = await run.start({
    inputData: { farmId: 2, memberId: 5, fieldId: 10, date: "2026-07-04", mm: 25 },
    requestContext: ctxFor(5),
  });
  assertEquals(res.status, "failed");
  assertEquals((await drafts(data, "draft")).length, 0);
});

Deno.test("farm-advice: FAO-56 reports stay short, as in the REST advice", opts, async () => {
  const registry = makeTestRegistry({
    farms: { 1: createMemoryFarmData(makeReference2022Fixture()) },
  });
  const mastra = await makeTestMastra({ registry });
  const run = await mastra.getWorkflow("farm-advice").createRun();
  const res = await run.start({ inputData: { farmId: 1, asOf: "2022-07-13" } });
  assertEquals(res.status, "success");
  const { service } = await registry.forFarm(1);
  // deno-lint-ignore no-explicit-any
  const advice = (res as any).result;
  assertEquals(advice, await service.getFarmAdvice("2022-07-13"));
  const f10 = advice.reports.find((r: { fieldId: number }) => r.fieldId === 10);
  assert(f10.stage, "FAO details are kept");
  assertEquals(f10.series, undefined);
  assertEquals(f10.season, undefined);
});

// --- correct-irrigation ---------------------------------------------------------

type TestMastra = Awaited<ReturnType<typeof setup>>["mastra"];

/** Starts a correction of the fixture's 30 mm on 2026-06-21 (operation 1, farm 1) by default. */
async function startCorrection(
  mastra: TestMastra,
  input: { operationId?: number; action: "update" | "delete"; date?: string; mm?: number },
  member = 1,
  farm = farmOf(member),
) {
  const run = await mastra.getWorkflow("correct-irrigation").createRun();
  const res = await run.start({
    inputData: { farmId: farm, memberId: member, operationId: 1, ...input },
    requestContext: ctxFor(member, farm),
  });
  return { run, res };
}

const resumeCorrection = async (
  mastra: TestMastra,
  runId: string,
  confirmed: boolean,
  member: number,
) =>
  (await mastra.getWorkflow("correct-irrigation").createRun({ runId })).resume({
    step: "confirm-correction",
    resumeData: { confirmed },
    requestContext: ctxFor(member),
  });

// deno-lint-ignore no-explicit-any
const failure = (res: any) => String(res.error?.message ?? res.error);

Deno.test("correct-irrigation: suspends with a summary, then yes updates", opts, async () => {
  const { data, mastra } = await setup();
  const { run, res } = await startCorrection(mastra, { action: "update", mm: 25 });
  assertEquals(res.status, "suspended");
  // deno-lint-ignore no-explicit-any
  const payload = (res as any).suspendPayload["confirm-correction"];
  assertEquals(
    payload.summary,
    "Change the irrigation on La Vallée from 30 mm on 2026-06-21 to 25 mm on 2026-06-21?",
  );
  assertEquals(payload.before, { date: "2026-06-21", mm: 30 });
  assertEquals(payload.after, { date: "2026-06-21", mm: 25 });
  assertEquals((await data.getIrrigation(1))?.mm, 30, "nothing changes before the answer");
  const done = await resumeCorrection(mastra, run.runId, true, 1);
  assertEquals(done.status, "success");
  // deno-lint-ignore no-explicit-any
  const out = (done as any).result;
  assertEquals(out.status, "updated");
  assertEquals([out.record.date, out.record.mm], ["2026-06-21", 25]);
  assertEquals((await data.getIrrigation(1))?.mm, 25);
});

Deno.test("correct-irrigation: yes on a delete removes the record", opts, async () => {
  const { data, mastra } = await setup();
  const { run, res } = await startCorrection(mastra, { action: "delete" });
  // deno-lint-ignore no-explicit-any
  assertEquals((res as any).suspendPayload["confirm-correction"].after, null);
  const done = await resumeCorrection(mastra, run.runId, true, 1);
  // deno-lint-ignore no-explicit-any
  assertEquals((done as any).result, { status: "deleted" });
  assertEquals(await data.getIrrigation(1), null);
});

Deno.test("correct-irrigation: no changes nothing", opts, async () => {
  const { data, mastra } = await setup();
  for (const input of [{ action: "update" as const, mm: 25 }, { action: "delete" as const }]) {
    const { run } = await startCorrection(mastra, input);
    const done = await resumeCorrection(mastra, run.runId, false, 1);
    // deno-lint-ignore no-explicit-any
    assertEquals((done as any).result, { status: "cancelled" });
  }
  const op = await data.getIrrigation(1);
  assertEquals([op?.date, op?.mm, op?.status], ["2026-06-21", 30, "confirmed"]);
});

Deno.test("correct-irrigation: another member cannot answer; the record stays", opts, async () => {
  const { data, mastra } = await setup();
  const { run } = await startCorrection(mastra, { action: "delete" }, 1);
  const res = await resumeCorrection(mastra, run.runId, true, 2);
  assertEquals(res.status, "failed");
  assertStringIncludes(failure(res), "only the member who started");
  assertEquals((await data.getIrrigation(1))?.mm, 30);
});

Deno.test(
  "correct-irrigation: one farm never corrects another farm's irrigation",
  opts,
  async () => {
    const { registry, data, mastra } = await setup();
    // A farm 2 member on farm 1's operation 1, then a farm 1 member on farm 2's operation 900.
    const fromFarm2 = await startCorrection(mastra, { action: "delete" }, 5);
    assertEquals(fromFarm2.res.status, "failed");
    assertStringIncludes(failure(fromFarm2.res), "not found");
    const fromFarm1 = await startCorrection(mastra, { operationId: 900, action: "delete" }, 1);
    assertEquals(fromFarm1.res.status, "failed");
    // A farm 2 member claiming farm 1 is not a member there.
    const claimed = await startCorrection(mastra, { action: "delete" }, 5, 1);
    assertEquals(claimed.res.status, "failed");
    assertStringIncludes(failure(claimed.res), "member 5 is not on farm 1");
    assertEquals((await data.getIrrigation(1))?.mm, 30);
    assertEquals((await (await registry.forFarm(2)).data.getIrrigation(900))?.mm, 25);
  },
);

Deno.test(
  "correct-irrigation: a draft or a non-irrigation operation is refused",
  opts,
  async () => {
    const { service, mastra } = await setup();
    const draft = await service.createDraftIrrigation({
      fieldId: 10,
      date: "2026-07-04",
      mm: 10,
      memberId: 1,
    });
    const onDraft = await startCorrection(mastra, {
      operationId: draft.operationId,
      action: "update",
      mm: 20,
    });
    assertEquals(onDraft.res.status, "failed");
    assertStringIncludes(failure(onDraft.res), "only confirmed irrigations");
    // 1003 is a fertilisation in farm 1's journal.
    const onFertiliser = await startCorrection(mastra, { operationId: 1003, action: "delete" });
    assertEquals(onFertiliser.res.status, "failed");
    assertStringIncludes(failure(onFertiliser.res), "not found");
  },
);

Deno.test("correct-irrigation: bad new values fail before the question", opts, async () => {
  const { data, mastra } = await setup();
  for (
    const input of [{ mm: 0 }, { mm: 250 }, { date: "2026-07-06" }, { date: "2026-03-01" }, {}]
  ) {
    const { res } = await startCorrection(mastra, { action: "update", ...input });
    assertEquals(res.status, "failed", JSON.stringify(input));
  }
  assertEquals((await data.getIrrigation(1))?.mm, 30);
});

Deno.test(
  "correct-irrigation: a record changed since the question is left alone",
  opts,
  async () => {
    const { data, service, mastra } = await setup();
    const { run } = await startCorrection(mastra, { action: "update", mm: 25 });
    await service.updateIrrigation(1, { mm: 28 });
    const res = await resumeCorrection(mastra, run.runId, true, 1);
    assertEquals(res.status, "failed");
    assertStringIncludes(failure(res), "changed since the question");
    assertEquals((await data.getIrrigation(1))?.mm, 28);
  },
);
