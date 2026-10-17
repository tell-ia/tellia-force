// Farm data lookup (farmLookup.service.ts) on in-memory farms, plus the Supabase reads and row
// mappers of the business tables. No network, no database.

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { HTTPException } from "hono/http-exception";
import { FarmLookupQuerySchema, FarmLookupSchema } from "@tellia/shared/farm";
import type { CropRef } from "../src/modules/irrigation/data/farmData.ts";
import {
  createMemoryFarmData,
  type FarmFixture,
} from "../src/modules/irrigation/data/memoryFarmData.ts";
import {
  createSupabaseFarmData,
  mapCropRef,
  mapFarmEconomics,
  mapMarketPrice,
  mapRegionalBenchmark,
  mapSale,
  mapSubsidy,
} from "../src/modules/irrigation/data/supabaseFarmData.ts";
import { resolveCrop } from "../src/modules/irrigation/farmLookup.service.ts";
import { makeFarmFixture, makeSecondFarmFixture } from "./fixtures/farm.ts";
import { makeTestRegistry, TEST_TODAY } from "./helpers/testApp.ts";

/** Both farms' services; `edit1` changes farm 1's fixture first. */
async function services(edit1?: (f: FarmFixture) => void) {
  const fx1 = makeFarmFixture();
  edit1?.(fx1);
  const registry = makeTestRegistry({
    farms: { 1: createMemoryFarmData(fx1), 2: createMemoryFarmData(makeSecondFarmFixture()) },
  });
  return {
    farm1: (await registry.forFarm(1)).service,
    farm2: (await registry.forFarm(2)).service,
  };
}

const is400 = (message: string) => (e: unknown) => {
  assert(e instanceof HTTPException, String(e));
  assertEquals(e.status, 400);
  assertStringIncludes(e.message, message);
};

Deno.test("sale: farm 1's 2024 harvest newest first, totals over every sale and per crop", async () => {
  const { farm1 } = await services();
  const l = await farm1.lookupFarmData({ table: "sale", year: 2024 });
  FarmLookupSchema.parse(l);
  assert(l.table === "sale");
  assertEquals([l.synthetic, l.year, l.cropCode, l.count, l.truncated], [
    true,
    2024,
    null,
    3,
    false,
  ]);
  assertStringIncludes(l.note, "Synthetic demo data");
  assertEquals(l.rows.map((r) => r.saleDate), ["2025-01-06", "2024-10-14", "2024-08-20"]);
  assertEquals(l.rows[0], {
    saleDate: "2025-01-06",
    cropCode: "COWT",
    cropName: "Blé tendre d'hiver",
    harvestYear: 2024,
    volumeT: 40,
    priceEurT: 200,
    revenueEur: 8000,
    buyer: "BUYER-02",
    contractType: "FORWARD",
    qualityGrade: "B",
  });
  // Two crops: no average price over both, but one per crop.
  assertEquals(l.summary, {
    volumeT: 150,
    revenueEur: 32900,
    averagePriceEurT: null,
    byCrop: [
      {
        cropCode: "COWT",
        cropName: "Blé tendre d'hiver",
        volumeT: 100,
        revenueEur: 22400,
        averagePriceEurT: 224,
      },
      { cropCode: "MAIZ", cropName: "Maïs", volumeT: 50, revenueEur: 10500, averagePriceEurT: 210 },
    ],
  });
});

Deno.test("sale: a crop by code or name in any language; weighted average; no sale", async () => {
  const { farm1 } = await services();
  for (const crop of ["COWT", "cowt", "wheat", "Blé", "blé tendre d'hiver"]) {
    const l = await farm1.lookupFarmData({ table: "sale", cropCode: crop });
    assert(l.table === "sale");
    assertEquals(l.cropCode, "COWT", crop);
    assertEquals(l.rows.map((r) => r.saleDate), ["2025-08-18", "2025-01-06", "2024-08-20"]);
    // (60 x 240 + 40 x 200 + 30 x 220) / 130 = 223.08, weighted by volume.
    assertEquals(
      [l.summary.volumeT, l.summary.revenueEur, l.summary.averagePriceEurT],
      [130, 29000, 223.08],
    );
  }
  const none = await farm1.lookupFarmData({ table: "sale", year: 2023 });
  assertEquals([none.count, none.rows, none.truncated], [0, [], false]);
  assertEquals(none.summary, { volumeT: 0, revenueEur: 0, averagePriceEurT: null, byCrop: [] });
  await assertRejects(
    () => farm1.lookupFarmData({ table: "sale", cropCode: "banana" }),
    HTTPException,
    "unknown crop",
  ).then(is400("COWT (Common winter wheat)"));
});

Deno.test("farm scoping: farm 2 never sees farm 1's sales, subsidies, accounts or region", async () => {
  const { farm1, farm2 } = await services();
  const sold2 = await farm2.lookupFarmData({ table: "sale" });
  assert(sold2.table === "sale");
  assertEquals(sold2.rows.map((r) => [r.saleDate, r.volumeT]), [["2024-10-20", 35], [
    "2024-07-30",
    12.5,
  ]]);
  // Farm 2 speaks Spanish; wheat has no Spanish name in the fixture (English then).
  assertEquals(sold2.rows.map((r) => r.cropName), ["Maíz", "Common winter wheat"]);
  assertEquals([sold2.summary.volumeT, sold2.summary.revenueEur], [47.5, 10050]);
  const sold1 = await farm1.lookupFarmData({ table: "sale", limit: 50 });
  assert(sold1.table === "sale");
  assertEquals(sold1.count, 5);
  assert(sold1.rows.every((r) => !["2024-10-20", "2024-07-30"].includes(r.saleDate)));

  const paid2 = await farm2.lookupFarmData({ table: "subsidy" });
  assert(paid2.table === "subsidy");
  assertEquals(paid2.rows.map((r) => r.scheme), ["BISS", "COUPLED"]);
  assertEquals(paid2.summary.totalEur, 9500.5);
  const accounts2 = await farm2.lookupFarmData({ table: "farm_economics" });
  assert(accounts2.table === "farm_economics");
  assertEquals(accounts2.rows.map((r) => [r.year, r.totalOutputEur]), [[2026, 71766.01]]);
  const region2 = await farm2.lookupFarmData({ table: "regional_benchmark" });
  assert(region2.table === "regional_benchmark");
  assertEquals(region2.rows.map((r) => [r.cropGroupCode, r.yieldTHa]), [["LMAIZ", 11.2]]);
});

Deno.test("market_price: global, newest first; months after the current month are forecasts", async () => {
  const { farm1, farm2 } = await services();
  assertEquals(TEST_TODAY.slice(0, 7), "2026-07");
  const l = await farm1.lookupFarmData({ table: "market_price", cropCode: "COWT", year: 2026 });
  FarmLookupSchema.parse(l);
  assert(l.table === "market_price");
  assertEquals([l.synthetic, l.summary, l.count], [true, null, 12]);
  assertEquals(l.rows.map((r) => r.month), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assertEquals(l.rows.filter((r) => r.forecast).map((r) => r.month), [12, 11, 10, 9, 8]);
  assertEquals(l.rows[5], {
    cropCode: "COWT",
    cropName: "Blé tendre d'hiver",
    year: 2026,
    month: 7,
    priceEurT: 227,
    forecast: false,
  });
  assert(l.rows.every((r) => r.forecast === r.month > 7));
  // A past year is never a forecast.
  const past = await farm1.lookupFarmData({ table: "market_price", year: 2025 });
  assert(past.table === "market_price");
  assert(past.rows.length === 12 && past.rows.every((r) => !r.forecast));
  // The same prices for every farm (crop names follow the farm's language).
  const l2 = await farm2.lookupFarmData({ table: "market_price", cropCode: "COWT", year: 2026 });
  assert(l2.table === "market_price");
  assertEquals(l2.rows.map((r) => r.priceEurT), l.rows.map((r) => r.priceEurT));
});

Deno.test("limit: default 20, at most 50; truncated and count cover every matching row", async () => {
  const { farm1 } = await services();
  const all = await farm1.lookupFarmData({ table: "market_price" });
  assert(all.table === "market_price");
  assertEquals([all.rows.length, all.count, all.truncated], [20, 28, true]);
  // Newest first, crops in code order within a month.
  assertEquals(all.rows.slice(3, 6).map((r) => `${r.year}-${r.month} ${r.cropCode}`), [
    "2026-9 COWT",
    "2026-9 MAIZ",
    "2026-8 COWT",
  ]);
  const fifty = await farm1.lookupFarmData({ table: "market_price", limit: 50 });
  assertEquals([fifty.rows.length, fifty.count, fifty.truncated], [28, 28, false]);
  const one = await farm1.lookupFarmData({ table: "sale", year: 2024, limit: 1 });
  assert(one.table === "sale");
  assertEquals([one.rows.length, one.count, one.truncated], [1, 3, true]);
  // The summary still covers the 3 sales, not only the one shown.
  assertEquals(one.summary.volumeT, 150);
  for (const limit of [0, 51, 2.5]) {
    await assertRejects(
      () => farm1.lookupFarmData({ table: "sale", limit }),
      HTTPException,
      "limit",
    );
  }
});

Deno.test("an unknown table is rejected by the input schema and the service", async () => {
  for (const table of ["member", "operation", "farm", "", "SALE"]) {
    assertEquals(FarmLookupQuerySchema.safeParse({ table }).success, false, table);
  }
  assertEquals(FarmLookupQuerySchema.safeParse({ table: "sale", year: 2024 }).success, true);
  const { farm1 } = await services();
  await assertRejects(
    // deno-lint-ignore no-explicit-any
    () => farm1.lookupFarmData({ table: "member" } as any),
    HTTPException,
    "table",
  ).then(is400("table"));
});

Deno.test("subsidy: total and per year from the server; cropCode does not apply", async () => {
  const { farm1 } = await services();
  const l = await farm1.lookupFarmData({ table: "subsidy" });
  assert(l.table === "subsidy");
  assertEquals(l.rows.map((r) => `${r.year} ${r.scheme}`), [
    "2026 BISS",
    "2026 CRISS",
    "2025 BISS",
    "2025 ECO_SCHEME",
  ]);
  assertEquals(l.summary, {
    totalEur: 29322.23,
    byYear: [{ year: 2026, totalEur: 12346.05 }, { year: 2025, totalEur: 16976.18 }],
  });
  const lastYear = await farm1.lookupFarmData({ table: "subsidy", year: 2025 });
  assert(lastYear.table === "subsidy");
  assertEquals([lastYear.count, lastYear.summary.totalEur], [2, 16976.18]);
  const withCrop = await farm1.lookupFarmData({ table: "subsidy", cropCode: "MAIZ" });
  assertEquals([withCrop.cropCode, withCrop.count], [null, 4]);
  assertStringIncludes(withCrop.note, "cropCode does not apply to subsidy");
});

Deno.test("farm_economics: the farm's years newest first, synthetic, no summary", async () => {
  const { farm1 } = await services();
  const l = await farm1.lookupFarmData({ table: "farm_economics" });
  FarmLookupSchema.parse(l);
  assert(l.table === "farm_economics");
  assertEquals([l.synthetic, l.summary], [true, null]);
  assertEquals(l.rows.map((r) => [r.year, r.farmNetValueAddedEur]), [[2026, 84998.63], [
    2025,
    78449.9,
  ]]);
  assertStringIncludes(l.note, "flat");
  const one = await farm1.lookupFarmData({ table: "farm_economics", year: 2025 });
  assertEquals(one.rows.length, 1);
});

Deno.test("regional_benchmark: real data of the farm's region; a crop filters on its group", async () => {
  const { farm1 } = await services((f) => {
    f.cropRefs.find((c) => c.code === "RAPE")!.cropGroupCode = null;
  });
  const l = await farm1.lookupFarmData({ table: "regional_benchmark" });
  FarmLookupSchema.parse(l);
  assert(l.table === "regional_benchmark");
  assertEquals([l.synthetic, l.summary], [false, null]);
  assertStringIncludes(l.note, "Real statistics");
  assertEquals(l.rows.map((r) => `${r.year} ${r.cropGroupCode}`), [
    "2020 CERE",
    "2020 LMAIZ",
    "2019 CERE",
  ]);
  const maize = await farm1.lookupFarmData({ table: "regional_benchmark", cropCode: "maïs" });
  assert(maize.table === "regional_benchmark");
  assertEquals([maize.cropCode, maize.rows.map((r) => r.cropGroupCode)], ["MAIZ", ["LMAIZ"]]);
  const wheat = await farm1.lookupFarmData({
    table: "regional_benchmark",
    cropCode: "COWT",
    year: 2019,
  });
  assert(wheat.table === "regional_benchmark");
  assertEquals(wheat.rows.map((r) => [r.cropGroupName, r.yieldTHa]), [[
    "Cereals excluding maize and rice",
    7.2,
  ]]);
  const noGroup = await farm1.lookupFarmData({ table: "regional_benchmark", cropCode: "RAPE" });
  assertEquals([noGroup.count, noGroup.rows], [0, []]);
  assertStringIncludes(noGroup.note, "RAPE has no crop group");
});

Deno.test("resolveCrop: code, exact name, words of a name; several or none is a 400", () => {
  const ref = (code: string, nameEn: string, names: Record<string, string> = {}): CropRef => ({
    code,
    nameFr: names.fr ?? nameEn,
    nameEn,
    names: { en: nameEn, ...names },
    gddBaseC: 0,
    kcIni: 0,
    kcMid: 0,
    kcEnd: 0,
  });
  const refs = [
    ref("COWT", "Winter wheat", { fr: "Blé tendre d'hiver", es: "Trigo blando de invierno" }),
    ref("BARL", "Winter barley", { fr: "Orge d'hiver" }),
    ref("MAIZ", "Grain maize", { fr: "Maïs", it: "Mais" }),
  ];
  assertEquals(resolveCrop("barl", refs).code, "BARL");
  assertEquals(resolveCrop("MAÏS", refs).code, "MAIZ");
  assertEquals(resolveCrop("trigo", refs).code, "COWT");
  assertEquals(resolveCrop("orge", refs).code, "BARL");
  try {
    resolveCrop("winter", refs);
    throw new Error("no error");
  } catch (e) {
    is400("several crops: COWT (Winter wheat), BARL (Winter barley)")(e);
  }
  try {
    resolveCrop("??", refs);
    throw new Error("no error");
  } catch (e) {
    is400("unknown crop")(e);
  }
});

// --- Supabase reads (fake client) -----------------------------------------------------

/** A fake Supabase client: records the tables and filters, answers `data` per table. */
function fakeDb(data: Record<string, unknown[]>, error: string | null = null) {
  const calls: [string, ...unknown[]][] = [];
  const db = {
    from: (table: string) => {
      calls.push(["from", table]);
      // deno-lint-ignore no-explicit-any
      const qb: any = {};
      for (const m of ["select", "eq", "limit", "order", "range"]) {
        qb[m] = (...a: unknown[]) => (["eq", "select"].includes(m) && calls.push([m, ...a]), qb);
      }
      qb.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve({
          data: error ? null : data[table] ?? [],
          error: error ? { message: error } : null,
        }).then(res, rej);
      return qb;
    },
  };
  // deno-lint-ignore no-explicit-any
  return { db: db as any, calls };
}

/** The `eq` filters of each table read, in order. */
const filtersOf = (calls: [string, ...unknown[]][]) => {
  const out: [string, ...unknown[]][] = [];
  for (const c of calls) {
    if (c[0] === "from") out.push([c[1] as string]);
    else if (c[0] === "eq") out[out.length - 1].push([c[1], c[2]]);
  }
  return out;
};

Deno.test("supabase lookup reads: farm tables on farm_id, prices global, benchmarks by region", async () => {
  const { db, calls } = fakeDb({
    farm: [{ id: 2, name: "SAT Los Olmos", nuts3_id: "ES418" }],
    sale: [{
      id: 7,
      sale_date: "2024-10-20",
      crop_code: "MAIZ",
      harvest_year: 2024,
      volume_t: "35",
      price_eur_t: 205,
    }],
    market_price: [{ crop_code: "MAIZ", year: 2026, month: 8, price_eur_t: 193.69 }],
    subsidy: [{ id: 3, year: 2026, scheme: "BISS", amount_eur: 8000 }],
    farm_economics: [{ year: 2026, total_output_eur: 71766.01 }],
    regional_benchmark: [{ crop_group_code: "LMAIZ", year: 2020, yield_t_ha: 11.2 }],
  });
  const d = createSupabaseFarmData(db, 2);
  assertEquals(
    (await d.listSales({ year: 2024, cropCode: "MAIZ" })).map((s) => [s.date, s.volumeT]),
    [["2024-10-20", 35]],
  );
  await d.listSales({});
  await d.listMarketPrices({ year: 2026, cropCode: "MAIZ" });
  await d.listSubsidies({ year: 2026 });
  await d.listFarmEconomics({});
  await d.listRegionalBenchmarks({ year: 2020, cropGroupCode: "LMAIZ" });
  assertEquals(filtersOf(calls), [
    ["sale", ["farm_id", 2], ["harvest_year", 2024], ["crop_code", "MAIZ"]],
    ["sale", ["farm_id", 2]],
    ["market_price", ["year", 2026], ["crop_code", "MAIZ"]],
    ["subsidy", ["farm_id", 2], ["year", 2026]],
    ["farm_economics", ["farm_id", 2]],
    ["farm", ["id", 2]],
    ["regional_benchmark", ["nuts3_id", "ES418"], ["year", 2020], ["crop_group_code", "LMAIZ"]],
  ]);
  assert(
    calls.some((c) => c[0] === "select" && String(c[1]).includes("price_eur_t")),
    "explicit columns",
  );
});

Deno.test("supabase listCropRefs: read once with the crop group; a failure throws and is retried", async () => {
  const { db, calls } = fakeDb({
    crop_ref: [{ crop_code: "COWT", crop_group_code: "CERE", name_fr: "Blé", name_en: "Wheat" }],
  });
  const d = createSupabaseFarmData(db, 1);
  assertEquals((await d.listCropRefs()).map((c) => [c.code, c.cropGroupCode]), [["COWT", "CERE"]]);
  await d.listCropRefs();
  assertEquals(calls.filter((c) => c[0] === "from").length, 1, "cached");

  const broken = fakeDb({}, "boom");
  const b = createSupabaseFarmData(broken.db, 1);
  await assertRejects(() => b.listCropRefs(), HTTPException, "boom");
  await assertRejects(() => b.listCropRefs(), HTTPException, "boom");
  assertEquals(broken.calls.filter((c) => c[0] === "from").length, 2, "not cached after a failure");
});

Deno.test("mappers: business rows snake_case -> camelCase, numbers as numbers", () => {
  assertEquals(
    mapSale({
      id: 1,
      farm_id: 1,
      sale_date: "2024-08-20",
      crop_code: "COWT",
      harvest_year: 2024,
      volume_t: "59.1",
      price_eur_t: "245.47",
      buyer: "BUYER-036",
      contract_type: "COOPERATIVE",
      quality_grade: null,
      origin: "generated",
    }),
    {
      id: 1,
      date: "2024-08-20",
      cropCode: "COWT",
      harvestYear: 2024,
      volumeT: 59.1,
      priceEurT: 245.47,
      buyer: "BUYER-036",
      contractType: "COOPERATIVE",
      qualityGrade: null,
    },
  );
  assertEquals(
    mapMarketPrice({ crop_code: "COWT", year: 2026, month: 12, price_eur_t: "202.32" }),
    {
      cropCode: "COWT",
      year: 2026,
      month: 12,
      priceEurT: 202.32,
    },
  );
  assertEquals(mapSubsidy({ id: 39, year: 2026, scheme: "CRISS", amount_eur: 1987.45 }), {
    id: 39,
    year: 2026,
    scheme: "CRISS",
    amountEur: 1987.45,
  });
  const econ = mapFarmEconomics({ year: 2026, total_output_eur: "99035.7", wages_eur: null });
  assertEquals([econ.year, econ.totalOutputEur, econ.wagesEur, econ.seedsEur], [
    2026,
    99035.7,
    null,
    null,
  ]);
  const bench = mapRegionalBenchmark({
    nuts3_id: "FRB06",
    crop_group_code: "LMAIZ",
    crop_group_name: "Maize",
    year: 2020,
    yield_t_ha: 15.99,
    yield_source_geography: "FRB0",
    yield_value_type: "regional_proxy",
    n_kg_ha: 147.53,
    npk_reference_year: 2020,
    irrigated_share: 0.89,
    pesticide_reference: "2018 median scenario",
  });
  assertEquals(
    [bench.cropGroupName, bench.yieldTHa, bench.yieldSourceGeography, bench.nKgHa, bench.k2oKgHa],
    ["Maize", 15.99, "FRB0", 147.53, null],
  );
  assert(!("nuts3Id" in bench));
  assertEquals(
    mapCropRef({ crop_code: "MAIZ", crop_group_code: "LMAIZ", name_fr: "Maïs", name_en: "Maize" })
      .cropGroupCode,
    "LMAIZ",
  );
});
