import { HTTPException } from "hono/http-exception";
import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  cropNameIn,
  OPERATION_SOURCES,
  pickCropPhases,
} from "../src/modules/irrigation/data/farmData";
import {
  createMemoryFarmData,
  createMemoryFarmDirectory,
} from "../src/modules/irrigation/data/memoryFarmData";
import {
  aridityIndex,
  averageByDay,
  createSupabaseFarmData,
  mapCropParams,
  mapCropPhaseRow,
  mapCropRef,
  mapCropSeason,
  mapIrrigationSystem,
  mapOperation,
  mapSoilWaterClass,
  mapWeatherDay,
  toOperationInsert,
  toOperationUpdate,
} from "../src/modules/irrigation/data/supabaseFarmData";
import { makeFarmFixture, makeSecondFarmFixture } from "./fixtures/farm.ts";
import { MAIZE_EARLY_PHASES, MAIZE_PARAMS, REEL_GUN, SOIL_CLASSES } from "./fixtures/fao.ts";

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
    source: "agent",
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
    source: "agent",
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
      source: "agent",
      memberId: 1,
    }, 12.5),
    {
      field_id: 10,
      crop_season_id: 109,
      op_date: "2026-07-05",
      op_type: "irrigation",
      water_mm: 25,
      status: "draft",
      source: "agent",
      origin: "assistant",
      member_id: 1,
      area_ha: 12.5,
    },
  );
});

Deno.test("memory twin: updateIrrigation changes date, mm and season only", async () => {
  const d = createMemoryFarmData(makeFarmFixture());
  const op = await d.updateIrrigation(1, {
    date: "2026-06-22",
    mm: 25,
    seasonId: 109,
    dateChanged: true,
  });
  assertEquals(op, {
    operationId: 1,
    fieldId: 10,
    seasonId: 109,
    date: "2026-06-22",
    mm: 25,
    status: "confirmed",
    source: "import",
    memberId: null,
  });
  assertEquals(await d.getIrrigation(1), op);
});

Deno.test("toOperationUpdate: the new date, mm and season, with updated_at", () => {
  const now = new Date("2026-07-05T08:00:00Z");
  // A new date clears the crop stage the import stored for the old date.
  assertEquals(
    toOperationUpdate({ date: "2026-06-22", mm: 25, seasonId: 109, dateChanged: true }, now),
    {
      op_date: "2026-06-22",
      water_mm: 25,
      crop_season_id: 109,
      bbch: null,
      updated_at: "2026-07-05T08:00:00.000Z",
    },
  );
  // Only the mm changes: the stage of that day stays.
  assertEquals(
    toOperationUpdate({ date: "2026-06-21", mm: 25, seasonId: 109, dateChanged: false }, now),
    {
      op_date: "2026-06-21",
      water_mm: 25,
      crop_season_id: 109,
      updated_at: "2026-07-05T08:00:00.000Z",
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
  assertEquals(toOperationInsert({ ...base, source: "web" }, null).origin, "app");
  assertEquals(toOperationInsert({ ...base, source: "agent" }, null).origin, "assistant");
});

Deno.test("OPERATION_SOURCES matches the operation.source check in seed/schema.sql", async () => {
  const sql = await Deno.readTextFile(new URL("../../../seed/schema.sql", import.meta.url));
  const check = sql.match(/create table operation \([\s\S]*?check \(source in \(([^)]*)\)\)/);
  assert(check, "operation.source check not found in seed/schema.sql");
  const allowed = check[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
  assertEquals([...OPERATION_SOURCES].sort(), allowed.sort());
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

Deno.test("memory twin: missing id is a 404 on status, update and delete", async () => {
  const d = createMemoryFarmData(makeFarmFixture());
  for (
    const call of [
      () => d.setIrrigationStatus(9999, "confirmed"),
      () =>
        d.updateIrrigation(9999, { date: "2026-07-01", mm: 10, seasonId: 109, dateChanged: true }),
      () => d.deleteIrrigation(9999),
    ]
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

Deno.test("supabase update/delete are scoped to the farm and op_type=irrigation, 404 when empty", async () => {
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
  const d = createSupabaseFarmData({ from: () => qb } as any, 1);
  for (
    const call of [
      () => d.setIrrigationStatus(5, "confirmed"),
      () => d.updateIrrigation(5, { date: "2026-07-01", mm: 10, seasonId: 109, dateChanged: true }),
      () => d.deleteIrrigation(5),
    ]
  ) {
    calls.length = 0;
    const e = await assertRejects(call, HTTPException);
    assertEquals(e.status, 404);
    assertEquals(calls, [["eq", "id", 5], ["eq", "farm_id", 1], ["eq", "op_type", "irrigation"]]);
  }
});

Deno.test("supabase farm reads filter on farm_id; weather on the farm's region", async () => {
  const calls: { table: string; eq: [string, unknown][] }[] = [];
  const builder = (table: string) => {
    const call = { table, eq: [] as [string, unknown][] };
    calls.push(call);
    const rowsFor = () =>
      table === "farm"
        ? [{ id: 2, name: "SAT Los Olmos", lat: 41.6, lon: -4.92, nuts3_id: "ES418" }]
        : [];
    // deno-lint-ignore no-explicit-any
    const qb: any = {
      select: () => qb,
      order: () => qb,
      limit: () => qb,
      gte: () => qb,
      lte: () => qb,
      not: () => qb,
      neq: () => qb,
      range: () => qb,
      eq: (c: string, v: unknown) => (call.eq.push([c, v]), qb),
      then: (res: (v: unknown) => unknown) => res({ data: rowsFor(), error: null }),
    };
    return qb;
  };
  // deno-lint-ignore no-explicit-any
  const d = createSupabaseFarmData({ from: builder } as any, 2);
  await d.listMembers();
  await d.listFields();
  await d.getMember(1);
  await d.getSeasonAt(10, "2026-07-05");
  await d.getSoil(10);
  await d.listIrrigations(10, { includeDrafts: true });
  await d.getIrrigation(7);
  await d.getWeather("2026-07-01", "2026-07-03");
  for (const c of calls.filter((c) => c.table !== "farm" && c.table !== "weather_daily")) {
    assert(c.eq.some(([k, v]) => k === "farm_id" && v === 2), `${c.table} not filtered on farm 2`);
  }
  const weather = calls.find((c) => c.table === "weather_daily")!;
  assert(weather.eq.some(([k, v]) => k === "nuts3_id" && v === "ES418"), "weather not by region");
});

Deno.test("mapCropRef keeps every language's crop name", () => {
  const ref = mapCropRef({
    crop_code: "MAIZ",
    name_fr: "Maïs grain",
    name_en: "Grain maize",
    name_es: "Maíz grano",
    name_it: "Mais da granella",
    name_de: null,
    gdd_base_c: 6,
    kc_ini: .3,
    kc_mid: 1.2,
    kc_end: .35,
  });
  assertEquals(ref.names, {
    fr: "Maïs grain",
    en: "Grain maize",
    es: "Maíz grano",
    it: "Mais da granella",
  });
  assertEquals(cropNameIn(ref, "es"), "Maíz grano");
  assertEquals(cropNameIn(ref, "de"), "Grain maize");
});

Deno.test("memory directory: members map to their farm, default is farm 1's main contact", async () => {
  const dir = createMemoryFarmDirectory([makeSecondFarmFixture(), makeFarmFixture()]);
  assertEquals(await dir.listFarmIds(), [1, 2]);
  assertEquals(await dir.farmOfMember(5), 2);
  assertEquals(await dir.farmOfMember(1), 1);
  assertEquals(await dir.farmOfMember(999), null);
  assertEquals(await dir.defaultMemberId(), 1);
  assertEquals(await dir.forFarm(2).getMember(1), null);
  assertEquals((await dir.forFarm(2).listFields()).map((f) => f.id), [15]);
});

// ---- FAO-56 data: crop values, crop phases, soil classes, irrigation system, aridity ----

type Row = Record<string, unknown>;

/** crop_phase_gdd rows as the seed writes them (maize early, its default copy, maize late). */
const PHASE_ROWS: Row[] = [
  {
    crop_code: "MAIZ",
    earliness_group: "early",
    ini_end: 320,
    dev_end: 760,
    mid_end: 1440,
    late_end: 1630,
    flowering: 850,
    sensitive_from: 750,
    sensitive_to: 1100,
    sensitive_p: 0.45,
    method: "Arvalis anchors",
  },
  {
    crop_code: "MAIZ",
    earliness_group: null,
    ini_end: 320,
    dev_end: 760,
    mid_end: 1440,
    late_end: 1630,
    flowering: 850,
    sensitive_from: 750,
    sensitive_to: 1100,
    sensitive_p: 0.45,
    method: "Default = early group. Arvalis anchors",
  },
  {
    crop_code: "MAIZ",
    earliness_group: "late",
    ini_end: 400,
    dev_end: 900,
    mid_end: 1700,
    late_end: 1900,
    flowering: 1000,
    sensitive_from: 900,
    sensitive_to: 1250,
    sensitive_p: 0.45,
    method: "Arvalis anchors",
  },
];

/** The FAO-56 tables, one farm per region, and the fields with their irrigation system. */
function faoTables(): Record<string, Row[]> {
  return {
    farm: [
      { id: 1, name: "GAEC des Trois Chênes", lat: 48.046, lon: 1.794, nuts3_id: "FRB06" },
      { id: 2, name: "SAT Los Olmos", lat: 41.6, lon: -4.92, nuts3_id: "ES418" },
    ],
    region: [
      { nuts3_id: "FRB06", mean_annual_precip_mm: 640, mean_annual_et0_mm: 800 },
      { nuts3_id: "ES418", mean_annual_precip_mm: 440, mean_annual_et0_mm: 1100 },
    ],
    fao56_crop_stages: [{ crop_code: "MAIZ", t_base_c: 6, t_max_cap_c: 30 }],
    fao56_kc: [{ crop_code: "MAIZ", kc_ini: 0.3, kc_mid: 1.2, kc_end: 0.6 }],
    fao56_root_depletion: [
      { crop_code: "MAIZ", zr_ini_m: 0.2, zr_max_default_m: 1.2, p_table: 0.55 },
    ],
    crop_phase_gdd: PHASE_ROWS,
    fao56_soil_water: SOIL_CLASSES.map((c) => ({
      texture_class_usda: c.textureClass,
      theta_fc_mid: c.thetaFcMid,
      theta_wp_mid: c.thetaWpMid,
    })),
    field: [
      { id: 10, farm_id: 1, irrigation_system_id: 1 },
      { id: 3, farm_id: 1, irrigation_system_id: null },
      { id: 15, farm_id: 2, irrigation_system_id: 2 },
    ],
    irrigation_system: [
      {
        id: 1,
        farm_id: 1,
        name: "Reel gun 1",
        system_type: "reel_gun",
        efficiency: 0.75,
        dose_min_mm: 20,
        dose_max_mm: 40,
        round_days: 3,
      },
      {
        id: 2,
        farm_id: 2,
        name: "Pivot",
        system_type: "pivot",
        efficiency: 0.85,
        dose_min_mm: 10,
        dose_max_mm: 25,
        round_days: 2,
      },
    ],
  };
}

/**
 * Fake Supabase client: `eq` filters the rows of each table, tables in `broken` answer with
 * an error (like a table missing from the DB), and every query is logged.
 */
function fakeDb(tables: Record<string, Row[]>, broken: string[] = []) {
  const queries: { table: string; eq: [string, unknown][] }[] = [];
  const from = (table: string) => {
    const q = { table, eq: [] as [string, unknown][] };
    queries.push(q);
    // deno-lint-ignore no-explicit-any
    const qb: any = {
      select: () => qb,
      order: () => qb,
      limit: () => qb,
      eq: (c: string, v: unknown) => (q.eq.push([c, v]), qb),
      then: (res: (v: unknown) => unknown) =>
        res(
          broken.includes(table)
            ? { data: null, error: { message: `relation "${table}" does not exist` } }
            : {
              data: (tables[table] ?? []).filter((r) => q.eq.every(([c, v]) => r[c] === v)),
              error: null,
            },
        ),
    };
    return qb;
  };
  // deno-lint-ignore no-explicit-any
  return { db: { from } as any, queries };
}

const countOf = (queries: { table: string }[], table: string) =>
  queries.filter((q) => q.table === table).length;

/** Runs `fn` with console.warn captured. */
async function captureWarnings(fn: () => Promise<void>): Promise<string[]> {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return warnings;
}

Deno.test("pickCropPhases: variety group row, else the crop's default row, else null", () => {
  const rows = PHASE_ROWS.map(mapCropPhaseRow);
  assertEquals(pickCropPhases(rows, "MAIZ", "late")?.phases.flowering, 1000);
  assertEquals(pickCropPhases(rows, "MAIZ", "early")?.method, "Arvalis anchors");
  // No row for the group, or no group: the default row.
  assertEquals(
    pickCropPhases(rows, "MAIZ", "very_early")?.method,
    "Default = early group. Arvalis anchors",
  );
  assertEquals(pickCropPhases(rows, "MAIZ", null)?.phases, MAIZE_EARLY_PHASES);
  // Only a group row and no default: an unknown group finds nothing.
  assertEquals(pickCropPhases(rows.filter((r) => r.earlinessGroup), "MAIZ", "half_late"), null);
  assertEquals(pickCropPhases(rows, "SUNF", "early"), null);
});

Deno.test("memory twin: FAO-56 fixture data, null / [] when the fixture has none", async () => {
  const fx = makeFarmFixture();
  const empty = createMemoryFarmData(fx);
  assertEquals(await empty.getCropParams("MAIZ"), null);
  assertEquals(await empty.getCropPhases("MAIZ", "early"), null);
  assertEquals(await empty.getSoilWaterClasses(), []);
  assertEquals(await empty.getIrrigationSystem(10), null);

  const d = createMemoryFarmData({
    ...fx,
    cropParams: { MAIZ: MAIZE_PARAMS },
    cropPhases: [{ cropCode: "MAIZ", earlinessGroup: "early", phases: MAIZE_EARLY_PHASES }],
    soilClasses: SOIL_CLASSES,
    irrigationSystems: { 10: REEL_GUN },
  });
  assertEquals(await d.getCropParams("MAIZ"), MAIZE_PARAMS);
  assertEquals(await d.getCropParams("COWT"), null);
  // The method defaults to null.
  assertEquals(await d.getCropPhases("MAIZ", "early"), {
    phases: MAIZE_EARLY_PHASES,
    method: null,
  });
  // The fixture has no default row: another group finds nothing.
  assertEquals(await d.getCropPhases("MAIZ", "late"), null);
  assertEquals(await d.getSoilWaterClasses(), SOIL_CLASSES);
  assertEquals(await d.getIrrigationSystem(10), REEL_GUN);
  assertEquals(await d.getIrrigationSystem(11), null);
});

Deno.test("mapCropParams joins the three FAO-56 rows; null when a row or value is missing", () => {
  const [stages, kc, roots] = [
    faoTables().fao56_crop_stages[0],
    faoTables().fao56_kc[0],
    faoTables().fao56_root_depletion[0],
  ];
  assertEquals(mapCropParams(stages, kc, roots), MAIZE_PARAMS);
  // Numeric columns may arrive as strings.
  assertEquals(mapCropParams({ ...stages, t_base_c: "6" }, kc, roots)?.tBaseC, 6);
  // Only the Tmax cap may be empty.
  assertEquals(mapCropParams({ ...stages, t_max_cap_c: null }, kc, roots)?.tMaxCapC, null);
  assertEquals(mapCropParams(stages, null, roots), null);
  assertEquals(mapCropParams(stages, { ...kc, kc_mid: null }, roots), null);
  assertEquals(mapCropParams(stages, kc, { ...roots, p_table: "n/a" }), null);
});

Deno.test("mapCropPhaseRow maps a crop_phase_gdd row; the sensitive window needs from, to and p", () => {
  assertEquals(mapCropPhaseRow(PHASE_ROWS[0]), {
    cropCode: "MAIZ",
    earlinessGroup: "early",
    phases: MAIZE_EARLY_PHASES,
    method: "Arvalis anchors",
  });
  const noWindow = mapCropPhaseRow({ ...PHASE_ROWS[1], sensitive_p: null, flowering: null });
  assertEquals(noWindow.earlinessGroup, null);
  assertEquals(noWindow.phases.sensitive, null);
  assertEquals(noWindow.phases.flowering, null);
});

Deno.test("row mappers: soil class, irrigation system, earliness, Tmax, aridity", () => {
  assertEquals(
    mapSoilWaterClass({
      texture_class_usda: "Silt clay loam",
      theta_fc_mid: 0.335,
      theta_wp_mid: 0.205,
    }),
    SOIL_CLASSES[3],
  );
  assertEquals(mapSoilWaterClass({ texture_class_usda: "Peat", theta_fc_mid: null }), null);
  assertEquals(mapIrrigationSystem(faoTables().irrigation_system[0]), REEL_GUN);
  assertEquals(
    mapIrrigationSystem({ id: 3, name: "Drip", efficiency: "0.9" }),
    {
      id: 3,
      name: "Drip",
      type: null,
      efficiency: 0.9,
      doseMinMm: null,
      doseMaxMm: null,
      roundDays: null,
    },
  );
  const season = {
    id: 1,
    crop_code: "MAIZ",
    sowing_date: "2022-05-03",
    harvest_date: "2022-10-15",
    status: "harvested",
  };
  assertEquals(mapCropSeason({ ...season, earliness_group: "early" }).earlinessGroup, "early");
  assertEquals(mapCropSeason({ ...season, earliness_group: null }).earlinessGroup, null);
  assertEquals(mapWeatherDay({ date: "2022-07-12", tmax_c: 31.4 }).tmax, 31.4);
  assertEquals(mapWeatherDay({ date: "2022-07-12" }).tmax, null);
  assertEquals(aridityIndex({ mean_annual_precip_mm: 440, mean_annual_et0_mm: 1100 }), 0.4);
  assertEquals(aridityIndex({ mean_annual_precip_mm: 440, mean_annual_et0_mm: 0 }), null);
  assertEquals(aridityIndex(null), null);
});

Deno.test("supabase FAO-56 reads: values per crop, reference tables read once per FarmData", async () => {
  const { db, queries } = fakeDb(faoTables());
  const d = createSupabaseFarmData(db, 1);
  assertEquals(await d.getCropParams("MAIZ"), MAIZE_PARAMS);
  assertEquals(await d.getCropParams("COWT"), null);
  assertEquals(await d.getCropPhases("MAIZ", "early"), {
    phases: MAIZE_EARLY_PHASES,
    method: "Arvalis anchors",
  });
  assertEquals((await d.getCropPhases("MAIZ", "half_early"))?.method, PHASE_ROWS[1].method);
  assertEquals(await d.getCropPhases("SUNF", "early"), null);
  assertEquals(await d.getSoilWaterClasses(), SOIL_CLASSES);
  await d.getSoilWaterClasses();
  for (
    const table of [
      "fao56_crop_stages",
      "fao56_kc",
      "fao56_root_depletion",
      "crop_phase_gdd",
      "fao56_soil_water",
    ]
  ) {
    assertEquals(countOf(queries, table), 1, `${table} read more than once`);
  }
});

Deno.test("supabase FAO-56 reads: a missing table logs one warning, gives null / [], is retried", async () => {
  const { db, queries } = fakeDb(faoTables(), ["crop_phase_gdd", "fao56_soil_water", "fao56_kc"]);
  const d = createSupabaseFarmData(db, 1);
  const warnings = await captureWarnings(async () => {
    for (let i = 0; i < 2; i++) {
      assertEquals(await d.getCropPhases("MAIZ", "early"), null);
      assertEquals(await d.getSoilWaterClasses(), []);
      assertEquals(await d.getCropParams("MAIZ"), null);
    }
  });
  assertEquals(warnings.length, 3, warnings.join("\n"));
  assert(warnings.some((w) => w.includes("crop_phase_gdd")));
  // Failures are not cached: the table may appear later. Tables that answered are.
  assertEquals(countOf(queries, "crop_phase_gdd"), 2);
  assertEquals(countOf(queries, "fao56_crop_stages"), 1);
});

Deno.test("supabase getIrrigationSystem: the field's system, scoped to the farm", async () => {
  const { db, queries } = fakeDb(faoTables());
  const d = createSupabaseFarmData(db, 1);
  assertEquals(await d.getIrrigationSystem(10), REEL_GUN);
  assertEquals(await d.getIrrigationSystem(3), null); // no system
  assertEquals(await d.getIrrigationSystem(15), null); // farm 2's field
  for (const q of queries) {
    assert(q.eq.some(([k, v]) => k === "farm_id" && v === 1), `${q.table} not filtered on farm 1`);
  }
  assertEquals((await createSupabaseFarmData(db, 2).getIrrigationSystem(15))?.efficiency, 0.85);

  const broken = createSupabaseFarmData(fakeDb(faoTables(), ["irrigation_system"]).db, 1);
  const warnings = await captureWarnings(async () => {
    assertEquals(await broken.getIrrigationSystem(10), null);
  });
  assertEquals(warnings.length, 1);
});

Deno.test("supabase getFarm: aridity index of the farm's region, read once", async () => {
  const { db, queries } = fakeDb(faoTables());
  const es = createSupabaseFarmData(db, 2);
  assertEquals((await es.getFarm()).aridityIndex, 0.4); // Valladolid: dry
  await es.getFarm();
  assertEquals(countOf(queries, "region"), 1);
  const region = queries.find((q) => q.table === "region")!;
  assertEquals(region.eq, [["nuts3_id", "ES418"]]);
  assertEquals((await createSupabaseFarmData(db, 1).getFarm()).aridityIndex, 0.8); // Loiret

  // No region data: the farm still loads, without aridity.
  const noRegion = createSupabaseFarmData(fakeDb(faoTables(), ["region"]).db, 1);
  const warnings = await captureWarnings(async () => {
    const farm = await noRegion.getFarm();
    assertEquals(farm.name, "GAEC des Trois Chênes");
    assertEquals(farm.aridityIndex, null);
  });
  assertEquals(warnings.length, 1);
});
