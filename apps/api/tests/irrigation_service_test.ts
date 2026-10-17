import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { HTTPException } from "hono/http-exception";
import { createMemoryFarmData } from "../src/modules/irrigation/data/memoryFarmData";
import { createIrrigationService } from "../src/modules/irrigation/irrigation.service";
import { createWeatherService } from "../src/modules/irrigation/weather/weatherService";
import { makeFarmFixture } from "./fixtures/farm";

/** Fake Open-Meteo: records requests, returns no extra days. */
function setup() {
  const requests: { start: string; end: string }[] = [];
  const fakeFetch: typeof fetch = (input) => {
    const u = new URL(String(input));
    requests.push({
      start: u.searchParams.get("start_date")!,
      end: u.searchParams.get("end_date")!,
    });
    return Promise.resolve(Response.json({
      daily: {
        time: [],
        et0_fao_evapotranspiration: [],
        precipitation_sum: [],
        temperature_2m_min: [],
        temperature_2m_mean: [],
      },
    }));
  };
  const data = createMemoryFarmData(makeFarmFixture());
  const weather = createWeatherService({ data, fetch: fakeFetch });
  const service = createIrrigationService({ data, weather, today: () => "2026-07-05" });
  return { data, service, requests };
}

async function status(p: Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HTTPException) return { status: e.status, message: e.message };
    throw e;
  }
  throw new Error("expected rejection");
}

Deno.test("farm advice ranks 10, 11, 3 with the expected decisions", async () => {
  const { service } = setup();
  const advice = await service.getFarmAdvice();
  assertEquals(advice.asOf, "2026-07-05");
  assertEquals(advice.reports.length, 3);
  const byId = Object.fromEntries(advice.reports.map((r) => [r.fieldId, r]));
  assertEquals(byId[11].decision, "outside_season");
  assertEquals(byId[3].decision, "not_irrigable");
  const f10 = byId[10];
  assert(f10.kc !== null && f10.kc >= 1.0 && f10.kc <= 1.2, `kc ${f10.kc}`);
  assert(f10.stageLabel === null || typeof f10.stageLabel === "string");
  assertEquals(advice.reports.map((r) => r.fieldId), [10, 3, 11]);
});

Deno.test("stage label comes from crop stages when labelled", async () => {
  const fixture = makeFarmFixture();
  fixture.cropStages.MAIZ = fixture.cropStages.MAIZ.map((s) => ({ ...s, label: "Grain fill" }));
  const data = createMemoryFarmData(fixture);
  const service = createIrrigationService({
    data,
    weather: createWeatherService({
      data,
      fetch: () => Promise.reject(new Error("no network expected")),
    }),
    today: () => "2026-07-05",
  });
  assertEquals((await service.getFieldReport(10)).stageLabel, "Grain fill");
});

Deno.test("out-of-season date: outside_season and no inverted weather request", async () => {
  const { service, requests } = setup();
  const r = await service.getFieldReport(10, "2026-03-01");
  assertEquals(r.decision, "outside_season");
  assertEquals(requests.length, 0);
  assert(requests.every((q) => q.start <= q.end));
});

Deno.test("confirmed irrigation lowers depletion by exactly its mm", async () => {
  const { service } = setup();
  const before = await service.getFieldReport(10);
  await service.recordIrrigation({
    fieldId: 10,
    date: "2026-07-04",
    mm: 30,
    memberId: 1,
    source: "web",
  });
  const after = await service.getFieldReport(10);
  assert(before.depletionMm > 30, `fixture depletion ${before.depletionMm}`);
  assertEquals(after.depletionMm, Math.round((before.depletionMm - 30) * 10) / 10);
});

Deno.test("drafts do not count; confirm is idempotent; cancel removes a draft", async () => {
  const { service } = setup();
  const base = await service.getFieldReport(10);
  const draft = await service.createDraftIrrigation({
    fieldId: 10,
    date: "2026-07-04",
    mm: 30,
    memberId: 1,
  });
  assertEquals(draft.status, "draft");
  assertEquals(await service.getFieldReport(10), base);
  assertEquals((await service.listIrrigations(10)).length, 1);

  const c1 = await service.confirmIrrigation(draft.operationId);
  assertEquals(c1.status, "confirmed");
  const changed = await service.getFieldReport(10);
  assert(changed.depletionMm < base.depletionMm);
  await service.confirmIrrigation(draft.operationId);
  const list = await service.listIrrigations(10);
  assertEquals(list.filter((r) => r.date === "2026-07-04").length, 1);
  assertEquals(list.length, 2);
  assertEquals((await service.getFieldReport(10)).depletionMm, changed.depletionMm);

  const d2 = await service.createDraftIrrigation({
    fieldId: 10,
    date: "2026-07-03",
    mm: 10,
    memberId: 1,
  });
  await service.cancelIrrigation(d2.operationId);
  assertEquals((await service.listIrrigations(10)).length, 2);
  assertEquals((await status(service.confirmIrrigation(d2.operationId))).status, 404);
  // A confirmed record cannot be cancelled.
  assertEquals((await status(service.cancelIrrigation(draft.operationId))).status, 409);
});

Deno.test("validation errors", async () => {
  const { service } = setup();
  const ok = { fieldId: 10, date: "2026-07-04", memberId: 1, source: "web" as const };
  assertEquals((await status(service.recordIrrigation({ ...ok, mm: 0 }))).status, 400);
  assertEquals((await status(service.recordIrrigation({ ...ok, mm: 250 }))).status, 400);
  const future = await status(service.recordIrrigation({ ...ok, mm: 10, date: "2026-07-06" }));
  assertEquals(future.status, 400);
  assertStringIncludes(future.message, "future");
  assertEquals(
    (await status(service.recordIrrigation({ ...ok, mm: 10, date: "2026-13-45" })))
      .status,
    400,
  );
  assertEquals(
    (await status(service.recordIrrigation({ ...ok, mm: 10, fieldId: 999 }))).status,
    404,
  );
  assertEquals(
    (await status(service.recordIrrigation({ ...ok, mm: 10, fieldId: 11 }))).status,
    400,
  );
  assertEquals((await status(service.getFieldReport(10, "2026-07-99"))).status, 400);
  assertEquals((await status(service.getFieldReport(999))).status, 404);
});

Deno.test("preview summary", async () => {
  const { service } = setup();
  const p = await service.previewIrrigation({ fieldId: 10, date: "2026-07-04", mm: 25 });
  assertEquals(p, {
    fieldId: 10,
    fieldName: "La Vallée",
    date: "2026-07-04",
    mm: 25,
    summary: "Record 25 mm on La Vallée for 2026-07-04?",
  });
});

Deno.test("scenario: 50 mm rain tomorrow gives comparison and a 21-day series", async () => {
  const { service } = setup();
  const r = await service.simulateScenario(10, [
    { type: "rain", date: "2026-07-06", mm: 50 },
  ]);
  assertEquals(r.asOf, "2026-07-05");
  assertEquals(r.series.length, 21);
  assertEquals(r.series[0].date, "2026-06-21");
  assertEquals(r.series[20].date, "2026-07-11");
  assertEquals(typeof r.comparison.summary, "string");
  assertEquals(r.baseline.fieldId, 10);
  assert(r.series.find((d) => d.date === "2026-07-06")!.rain >= 50);
});

Deno.test("getWeather covers asOf +-3 without gdd", async () => {
  const { service } = setup();
  const w = await service.getWeather(10);
  assertEquals(w.map((d) => d.date), [
    "2026-07-02",
    "2026-07-03",
    "2026-07-04",
    "2026-07-05",
    "2026-07-06",
    "2026-07-07",
    "2026-07-08",
  ]);
  assert(!("gdd" in w[0]));
});

Deno.test("listIrrigations: confirmed only, range, 404", async () => {
  const { service } = setup();
  const list = await service.listIrrigations(10);
  assertEquals(list, [{
    operationId: 1,
    fieldId: 10,
    date: "2026-06-21",
    mm: 30,
    status: "confirmed",
  }]);
  await service.createDraftIrrigation({ fieldId: 10, date: "2026-07-04", mm: 30, memberId: 1 });
  assertEquals((await service.listIrrigations(10)).length, 1);
  assertEquals((await service.listIrrigations(10, { from: "2026-06-22" })).length, 0);
  assertEquals((await service.listIrrigations(10, { to: "2026-06-21" })).length, 1);
  assertEquals((await status(service.listIrrigations(999))).status, 404);
});

Deno.test("resolveField", async () => {
  const { service } = setup();
  assertEquals((await service.resolveField("la vallee"))[0].fieldId, 10);
  assertEquals((await service.resolveField("le puits"))[0].fieldId, 11);
  assertEquals((await service.resolveField("le maïs"))[0].fieldId, 10);
  assertEquals((await service.resolveField("LA VALLÉE"))[0].name, "La Vallée");
  assertEquals(await service.resolveField("xyz"), []);
});

Deno.test("farm advice shares weather and crop lookups across fields", async () => {
  const fixture = makeFarmFixture();
  // Three fields on the same maize season.
  fixture.seasons[11] = [{ ...fixture.seasons[10][0], id: 211 }];
  fixture.seasons[3] = [{ ...fixture.seasons[10][0], id: 203 }];
  const inner = createMemoryFarmData(fixture);
  const calls = { weather: 0, ref: 0, stages: 0, fields: 0, climatology: 0 };
  const data: typeof inner = {
    ...inner,
    getWeather: (f, t) => (calls.weather++, inner.getWeather(f, t)),
    getCropRef: (c) => (calls.ref++, inner.getCropRef(c)),
    getCropStages: (c) => (calls.stages++, inner.getCropStages(c)),
    listFields: () => (calls.fields++, inner.listFields()),
    getGddClimatology: (b) => (calls.climatology++, inner.getGddClimatology(b)),
  };
  const weather = createWeatherService({
    data,
    fetch: () => Promise.reject(new Error("no network expected")),
  });
  const service = createIrrigationService({ data, weather, today: () => "2026-07-05" });
  const advice = await service.getFarmAdvice();
  assertEquals(advice.reports.length, 3);
  assert(advice.reports.every((r) => r.cropCode === "MAIZ"));
  assertEquals(calls.weather, 1);
  assertEquals(calls.ref, 1);
  assertEquals(calls.stages, 1);
  assertEquals(calls.fields, 1);
  assertEquals(calls.climatology, 1);
});

Deno.test("farm advice caps one application at 35 mm", async () => {
  const { service } = setup();
  // today + 7 at most (engine v2 date rule). The old 2026-08-20 had no weather, so it never irrigated.
  const r = (await service.getFarmAdvice("2026-07-12")).reports.find((x) => x.fieldId === 10)!;
  assertEquals(r.decision, "irrigate_today");
  assert(r.irrigateMm <= 35);
});

Deno.test("operation lookup uses getIrrigation (404 for unknown id)", async () => {
  const { service, data } = setup();
  assertEquals((await data.getIrrigation(1))?.fieldId, 10);
  assertEquals(await data.getIrrigation(4242), null);
  assertEquals((await status(service.confirmIrrigation(4242))).status, 404);
  assertEquals((await service.confirmIrrigation(1)).status, "confirmed");
});

// --- Irrigation corrections (Task 3) ------------------------------------------

const round1 = (x: number) => Math.round(x * 10) / 10;

Deno.test("correction preview: update and delete summaries; nothing changes", async () => {
  const { data, service } = setup();
  const up = await service.previewIrrigationCorrection({
    operationId: 1,
    action: "update",
    mm: 25,
  });
  assertEquals(up, {
    operationId: 1,
    fieldId: 10,
    fieldName: "La Vallée",
    action: "update",
    before: { date: "2026-06-21", mm: 30 },
    after: { date: "2026-06-21", mm: 25 },
    summary: "Change the irrigation on La Vallée from 30 mm on 2026-06-21 to 25 mm on 2026-06-21?",
  });
  const del = await service.previewIrrigationCorrection({ operationId: 1, action: "delete" });
  assertEquals(del.after, null);
  assertEquals(del.summary, "Delete the irrigation of 30 mm on La Vallée on 2026-06-21?");
  const op = await data.getIrrigation(1);
  assertEquals([op?.date, op?.mm], ["2026-06-21", 30]);
});

Deno.test("correction update: the water balance moves by the mm difference", async () => {
  const { data, service } = setup();
  // Yesterday's record, as in "confirmed irrigation lowers depletion by exactly its mm".
  const { operationId } = await service.recordIrrigation({
    fieldId: 10,
    date: "2026-07-04",
    mm: 30,
    memberId: 1,
    source: "web",
  });
  const before = await service.getFieldReport(10);
  const rec = await service.updateIrrigation(operationId, { mm: 20 });
  assertEquals(rec, { operationId, fieldId: 10, date: "2026-07-04", mm: 20, status: "confirmed" });
  // 10 mm less water: 10 mm more depletion today.
  assertEquals((await service.getFieldReport(10)).depletionMm, round1(before.depletionMm + 10));
  // A date alone keeps the mm; the record stays one record.
  const moved = await service.updateIrrigation(operationId, { date: "2026-07-03" });
  assertEquals([moved.date, moved.mm], ["2026-07-03", 20]);
  assertEquals((await data.getIrrigation(operationId))?.seasonId, 109);
  assertEquals((await service.listIrrigations(10)).length, 2);
});

Deno.test("correction update: a new date in another crop season moves the record there", async () => {
  const fx = makeFarmFixture();
  fx.seasons[10].push({
    id: 108,
    cropCode: "COWT",
    sowingDate: "2025-10-01",
    harvestDate: "2026-04-10",
    status: "harvested",
  });
  const data = createMemoryFarmData(fx);
  const weather = createWeatherService({ data, fetch: () => Promise.reject(new Error("offline")) });
  const service = createIrrigationService({ data, weather, today: () => "2026-07-05" });
  await service.updateIrrigation(1, { date: "2026-04-05" });
  assertEquals((await data.getIrrigation(1))?.seasonId, 108);
});

Deno.test("correction validation: same checks as a new record, confirmed irrigations only", async () => {
  const { data, service } = setup();
  const up = (operationId: number, change: { date?: string; mm?: number }) =>
    status(service.updateIrrigation(operationId, change));
  assertEquals((await up(1, { mm: 0 })).status, 400);
  assertEquals((await up(1, { mm: 250 })).status, 400);
  const future = await up(1, { date: "2026-07-06" });
  assertEquals(future.status, 400);
  assertStringIncludes(future.message, "future");
  const noSeason = await up(1, { date: "2026-03-01" });
  assertEquals(noSeason.status, 400);
  assertStringIncludes(noSeason.message, "no crop is growing");
  assertStringIncludes((await up(1, {})).message, "new date or the new mm");
  assertStringIncludes((await up(1, { mm: 30 })).message, "nothing to change");
  // A journal row that is not an irrigation, and an unknown id: 404.
  assertEquals((await up(1003, { mm: 20 })).status, 404);
  assertEquals((await status(service.deleteIrrigation(1003))).status, 404);
  assertEquals((await status(service.deleteIrrigation(4242))).status, 404);
  // A draft is not a record yet: 409.
  const draft = await service.createDraftIrrigation({
    fieldId: 10,
    date: "2026-07-04",
    mm: 10,
    memberId: 1,
  });
  assertEquals((await up(draft.operationId, { mm: 20 })).status, 409);
  assertEquals((await status(service.deleteIrrigation(draft.operationId))).status, 409);
  const preview = service.previewIrrigationCorrection({
    operationId: draft.operationId,
    action: "delete",
  });
  assertStringIncludes((await status(preview)).message, "only confirmed irrigations");
  // The refusals changed nothing.
  assertEquals((await data.getIrrigation(1))?.mm, 30);
  assertEquals((await data.getIrrigation(draft.operationId))?.status, "draft");
});

Deno.test("correction delete: removes the record and returns it as it was", async () => {
  const { data, service } = setup();
  const before = await service.getFieldReport(10);
  const rec = await service.deleteIrrigation(1);
  assertEquals(rec, {
    operationId: 1,
    fieldId: 10,
    date: "2026-06-21",
    mm: 30,
    status: "confirmed",
  });
  assertEquals(await data.getIrrigation(1), null);
  assertEquals(await service.listIrrigations(10), []);
  assert((await service.getFieldReport(10)).depletionMm > before.depletionMm);
});
