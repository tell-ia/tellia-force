import { assert, assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";
import { RequestContext } from "@mastra/core/request-context";
import type { FarmData } from "../src/modules/irrigation/data/farmData.ts";
import { createMemoryFarmData } from "../src/modules/irrigation/data/memoryFarmData.ts";
import { createIrrigationService } from "../src/modules/irrigation/irrigation.service.ts";
import { createWeatherService } from "../src/modules/irrigation/weather/weatherService.ts";
import { MEMBER_ID_KEY } from "../src/modules/chat/requestContext.ts";
import { makeFarmFixture } from "./fixtures/farm.ts";
import { emptyOpenMeteoFetch, makeTestMastra } from "./helpers/testApp.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };

export const ctxFor = (memberId: number) => {
  const rc = new RequestContext();
  rc.set(MEMBER_ID_KEY, memberId);
  return rc;
};

async function setup() {
  const data = createMemoryFarmData(makeFarmFixture());
  const weather = createWeatherService({ data, fetch: emptyOpenMeteoFetch });
  const service = createIrrigationService({ data, weather, today: () => "2026-07-05" });
  const mastra = await makeTestMastra({ service, data });
  return { data, service, mastra };
}

const drafts = async (data: FarmData, status?: string) =>
  (await data.listIrrigations(10, { includeDrafts: true })).filter((o) =>
    status ? o.status === status : true
  );

Deno.test("farm-advice: same reports and order as the service", opts, async () => {
  const { service, mastra } = await setup();
  const run = await mastra.getWorkflow("farm-advice").createRun();
  const res = await run.start({ inputData: {} });
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
    inputData: { fieldId: 10, events: [{ type: "rain", date: "2026-07-06", mm: 50 }] },
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
    inputData: { memberId: member, fieldId: 10, date: "2026-07-04", mm: 25 },
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
      inputData: { memberId: 1, fieldId: 10, date: "2026-07-06", mm: 25 },
      requestContext: ctxFor(1),
    });
    assertEquals(res.status, "failed");
    // deno-lint-ignore no-explicit-any
    assertStringIncludes(String((res as any).error?.message ?? (res as any).error), "future");
    assertEquals((await drafts(data, "draft")).length, 0);
  },
);

Deno.test("morning-warmup: succeeds and fills the weather cache", opts, async () => {
  const fixture = makeFarmFixture();
  const base = createMemoryFarmData(fixture);
  let weatherReads = 0;
  const data: FarmData = {
    ...base,
    getWeather: (from, to) => {
      weatherReads++;
      return base.getWeather(from, to);
    },
  };
  const weather = createWeatherService({ data, fetch: emptyOpenMeteoFetch });
  const service = createIrrigationService({ data, weather, today: () => "2026-07-05" });
  const mastra = await makeTestMastra({ service, data });
  const run = await mastra.getWorkflow("morning-warmup").createRun();
  const res = await run.start({ inputData: {} });
  assertEquals(res.status, "success");
  // deno-lint-ignore no-explicit-any
  const out = (res as any).result;
  assertEquals(out.fields, 3);
  assertEquals(out.failures, 0);
  assert(weatherReads > 0);
  const warmed = weatherReads;
  await service.getFarmAdvice();
  assertEquals(weatherReads, warmed);
});

Deno.test("morning-warmup: declares the 05:00 Europe/Paris schedule", opts, async () => {
  const { mastra } = await setup();
  const schedules = mastra.getWorkflow("morning-warmup").getScheduleConfigs?.() ?? [];
  assertEquals(schedules.length, 1);
  assertEquals(schedules[0].cron, "0 5 * * *");
  assertEquals(schedules[0].timezone, "Europe/Paris");
});

Deno.test("morning-warmup: every field failing fails the run", opts, async () => {
  const data = createMemoryFarmData(makeFarmFixture());
  const weather = createWeatherService({ data, fetch: emptyOpenMeteoFetch });
  const real = createIrrigationService({ data, weather, today: () => "2026-07-05" });
  const service = {
    ...real,
    getFieldReport: () => Promise.reject(new Error("weather offline")),
  };
  const mastra = await makeTestMastra({ service, data });
  const run = await mastra.getWorkflow("morning-warmup").createRun();
  const res = await run.start({ inputData: {} });
  assertEquals(res.status, "failed");
  // deno-lint-ignore no-explicit-any
  assertStringIncludes(
    String((res as any).error?.message ?? (res as any).error),
    "weather offline",
  );
});
