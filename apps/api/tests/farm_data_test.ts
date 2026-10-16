import { HTTPException } from "hono/http-exception";
import { assertEquals, assertRejects } from "@std/assert";
import { createMemoryFarmData } from "../src/modules/irrigation/data/memoryFarmData";
import {
  averageByDay,
  createSupabaseFarmData,
  mapCropSeason,
  mapOperation,
  toOperationInsert,
} from "../src/modules/irrigation/data/supabaseFarmData";
import { makeFarmFixture } from "./fixtures/farm.ts";

Deno.test("getSeasonAt picks the containing season, or null", async () => {
  const d = createMemoryFarmData(makeFarmFixture());
  assertEquals((await d.getSeasonAt(10, "2026-07-05"))?.id, 109);
  assertEquals((await d.getSeasonAt(10, "2026-07-05"))?.cropCode, "MAIZ");
  assertEquals(await d.getSeasonAt(10, "2026-12-01"), null);
});

Deno.test("listIrrigations excludes drafts unless asked", async () => {
  const d = createMemoryFarmData(makeFarmFixture());
  await d.createIrrigation({
    fieldId: 10,
    seasonId: 109,
    date: "2026-07-01",
    mm: 20,
    status: "draft",
    source: "assistant",
    memberId: 1,
  });
  assertEquals((await d.listIrrigations(10, { includeDrafts: false })).length, 1);
  assertEquals((await d.listIrrigations(10, { includeDrafts: true })).length, 2);
});

Deno.test("create, confirm, delete lifecycle", async () => {
  const d = createMemoryFarmData(makeFarmFixture());
  const op = await d.createIrrigation({
    fieldId: 10,
    seasonId: 109,
    date: "2026-07-01",
    mm: 20,
    status: "draft",
    source: "assistant",
    memberId: 1,
  });
  assertEquals(op.status, "draft");
  const c = await d.setIrrigationStatus(op.operationId, "confirmed");
  assertEquals(c.status, "confirmed");
  assertEquals((await d.listIrrigations(10, { includeDrafts: false })).length, 2);
  await d.deleteIrrigation(op.operationId);
  assertEquals((await d.listIrrigations(10, { includeDrafts: true })).length, 1);
  await assertRejects(() => d.setIrrigationStatus(9999, "confirmed"));
});

Deno.test("unknown member is null; known one is found", async () => {
  const d = createMemoryFarmData(makeFarmFixture());
  assertEquals(await d.getMember(999), null);
  assertEquals((await d.getMember(1))?.mainContact, true);
});

Deno.test("climatology '07-05' is 14 for base 6", async () => {
  const d = createMemoryFarmData(makeFarmFixture());
  assertEquals((await d.getGddClimatology(6)).get("07-05"), 14);
});

Deno.test("fixture weather, soil and stages", async () => {
  const d = createMemoryFarmData(makeFarmFixture());
  assertEquals((await d.getWeather("2026-07-01", "2026-07-03")).length, 3);
  assertEquals(await d.getSoil(3), null);
  assertEquals((await d.getCropStages("MAIZ")).length, 11);
  assertEquals(await d.getCropStages("COWT"), []);
});

Deno.test("mapOperation maps a snake_case row", () => {
  const row = {
    id: 7,
    field_id: 10,
    crop_season_id: 109,
    op_date: "2026-06-21",
    op_type: "irrigation",
    status: "confirmed",
    source: "import",
    member_id: null,
    water_mm: 30.7,
    origin: "dataset_adjusted",
  };
  assertEquals(mapOperation(row), {
    operationId: 7,
    fieldId: 10,
    seasonId: 109,
    date: "2026-06-21",
    mm: 30.7,
    status: "confirmed",
    source: "import",
    memberId: null,
  });
});

Deno.test("mapCropSeason maps a row", () => {
  assertEquals(
    mapCropSeason({
      id: 109,
      crop_code: "MAIZ",
      sowing_date: "2026-04-16",
      harvest_date: "2026-10-17",
      status: "growing",
    }),
    {
      id: 109,
      cropCode: "MAIZ",
      sowingDate: "2026-04-16",
      harvestDate: "2026-10-17",
      status: "growing",
    },
  );
});

Deno.test("toOperationInsert builds the snake_case row", () => {
  assertEquals(
    toOperationInsert({
      fieldId: 10,
      seasonId: 109,
      date: "2026-07-05",
      mm: 25,
      status: "draft",
      source: "assistant",
      memberId: 1,
    }, 12.5),
    {
      field_id: 10,
      crop_season_id: 109,
      op_date: "2026-07-05",
      op_type: "irrigation",
      water_mm: 25,
      status: "draft",
      source: "assistant",
      origin: "assistant",
      member_id: 1,
      area_ha: 12.5,
    },
  );
});

Deno.test("toOperationInsert: origin is app for the REST source, assistant otherwise", () => {
  const base = {
    fieldId: 10,
    seasonId: 109,
    date: "2026-07-05",
    mm: 25,
    status: "confirmed" as const,
    memberId: 1,
  };
  assertEquals(toOperationInsert({ ...base, source: "app" }, null).origin, "app");
  assertEquals(toOperationInsert({ ...base, source: "assistant" }, null).origin, "assistant");
});

Deno.test("averageByDay averages per MM-DD and folds Feb 29 into Feb 28", () => {
  const m = averageByDay([
    { date: "2015-07-05", value: 10 },
    { date: "2016-07-05", value: 20 },
    { date: "2016-02-29", value: 4 },
    { date: "2017-02-28", value: 2 },
    { date: "2017-03-01", value: null },
  ]);
  assertEquals(m.get("07-05"), 15);
  assertEquals(m.get("02-28"), 3);
  assertEquals(m.has("02-29"), false);
  assertEquals(m.has("03-01"), false);
});

Deno.test("memory twin: missing id is a 404 on status and delete", async () => {
  const d = createMemoryFarmData(makeFarmFixture());
  for (
    const call of [() => d.setIrrigationStatus(9999, "confirmed"), () => d.deleteIrrigation(9999)]
  ) {
    const e = await assertRejects(call, HTTPException);
    assertEquals(e.status, 404);
    assertEquals(e.message, "irrigation operation 9999 not found");
  }
});

Deno.test("getSeasonAt prefers the latest sowing date when seasons overlap", async () => {
  const fx = makeFarmFixture();
  fx.seasons[10].push({
    id: 200,
    cropCode: "COWT",
    sowingDate: "2026-06-01",
    harvestDate: "2027-07-01",
    status: "growing",
  });
  const d = createMemoryFarmData(fx);
  assertEquals((await d.getSeasonAt(10, "2026-07-05"))?.id, 200);
  assertEquals((await d.getSeasonAt(10, "2026-05-05"))?.id, 109);
});

Deno.test("supabase update/delete are scoped to op_type=irrigation and 404 when empty", async () => {
  const calls: [string, unknown, unknown][] = [];
  // deno-lint-ignore no-explicit-any
  const qb: any = {
    update: () => qb,
    delete: () => qb,
    select: () => qb,
    eq: (c: string, v: unknown) => (calls.push(["eq", c, v]), qb),
    then: (res: (v: unknown) => unknown) => res({ data: [], error: null }),
  };
  // deno-lint-ignore no-explicit-any
  const d = createSupabaseFarmData({ from: () => qb } as any);
  for (const call of [() => d.setIrrigationStatus(5, "confirmed"), () => d.deleteIrrigation(5)]) {
    calls.length = 0;
    const e = await assertRejects(call, HTTPException);
    assertEquals(e.status, 404);
    assertEquals(calls, [["eq", "id", 5], ["eq", "op_type", "irrigation"]]);
  }
});
