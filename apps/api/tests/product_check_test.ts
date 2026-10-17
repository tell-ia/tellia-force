// Product check (productCheck.service.ts) on in-memory farms, plus the Supabase product reads
// and row mappers. No network, no database.

import { assert, assertEquals, assertRejects } from "@std/assert";
import { HTTPException } from "hono/http-exception";
import { ProductCheckSchema } from "@tellia/shared/farm";
import type { FarmOperation } from "../src/modules/irrigation/data/farmData.ts";
import {
  createMemoryFarmData,
  type FarmFixture,
} from "../src/modules/irrigation/data/memoryFarmData.ts";
import {
  createSupabaseFarmData,
  mapFarm,
  mapProduct,
  mapProductUse,
} from "../src/modules/irrigation/data/supabaseFarmData.ts";
import { matchProducts, NO_EPHY_DATA } from "../src/modules/irrigation/productCheck.service.ts";
import { makeFarmFixture, makeSecondFarmFixture } from "./fixtures/farm.ts";
import { makeTestRegistry, TEST_TODAY } from "./helpers/testApp.ts";

/** Both farms' services; `edit1` / `edit2` change a farm's fixture first. */
async function services(
  edit1?: (f: FarmFixture) => void,
  edit2?: (f: FarmFixture) => void,
) {
  const fx1 = makeFarmFixture();
  const fx2 = makeSecondFarmFixture();
  edit1?.(fx1);
  edit2?.(fx2);
  const registry = makeTestRegistry({
    farms: { 1: createMemoryFarmData(fx1), 2: createMemoryFarmData(fx2) },
  });
  return {
    farm1: (await registry.forFarm(1)).service,
    farm2: (await registry.forFarm(2)).service,
  };
}

/** A confirmed spray of one product (default: DECIS PROTECH on La Vallée's maize season). */
function spray(
  operationId: number,
  date: string,
  o: Partial<FarmOperation> & { productId?: number | null; productName?: string } = {},
): FarmOperation {
  const { productId = 504, productName = "DECIS PROTECH", ...rest } = o;
  return {
    operationId,
    fieldId: 10,
    seasonId: 109,
    date,
    type: "spraying",
    status: "confirmed",
    products: [{ productId, productName, dose: 0.6, doseUnit: "L/ha", target: "Pyrale" }],
    ...rest,
  };
}

// ---- finding the product ----

Deno.test("product check: name match ignores accents, case and punctuation", async () => {
  const { farm1 } = await services();
  for (const q of ["karaté avec technologie zéon", "KARATE-ZEON", "Karate Zeon", "zeon"]) {
    const c = ProductCheckSchema.parse(await farm1.checkProductUse({ product: q, fieldId: 10 }));
    assertEquals([c.status, c.product?.productId], ["found", 503], q);
    assertEquals(c.query, q);
  }
  const callisto = await farm1.checkProductUse({ product: "callisto", fieldId: 10 });
  assertEquals(callisto.product, {
    productId: 502,
    name: "CALLISTO",
    ammNumber: "9900047",
    kind: "herbicide",
    activeSubstances: "mésotrione 100.0 g/L",
    synthetic: false,
  });
  // The whole name inside a longer query.
  const inSentence = await farm1.checkProductUse({ product: "callisto sur le maïs", fieldId: 10 });
  assertEquals(inSentence.product?.name, "CALLISTO");
});

Deno.test("product check: AMM number match", async () => {
  const { farm1 } = await services();
  for (const q of ["9800336", "AMM 9800336", "amm n° 9800336"]) {
    const c = await farm1.checkProductUse({ product: q, fieldId: 10 });
    assertEquals([c.status, c.product?.name], ["found", "KARATE AVEC TECHNOLOGIE ZEON"], q);
  }
});

Deno.test("product check: several matches give the list and no verdict", async () => {
  const { farm1 } = await services();
  const c = ProductCheckSchema.parse(
    await farm1.checkProductUse({ product: "Karaté", fieldId: 10 }),
  );
  assertEquals(c.status, "ambiguous");
  assertEquals(c.matches.map((m) => m.name), ["KARATE AVEC TECHNOLOGIE ZEON", "KARATE K"]);
  assertEquals(
    [c.product, c.authorised, c.usage, c.applicationsLeft, c.preHarvestOk],
    [null, null, null, null, null],
  );
  assertEquals([c.uses, c.warnings], [[], []]);
  // The crop is a fact of the field, not a verdict.
  assertEquals([c.crop?.code, c.daysToHarvest], ["MAIZ", 104]);
  // An exact name wins over longer names: AMISTAR, not AMISTAR GOLD.
  const amistar = await farm1.checkProductUse({ product: "Amistar", fieldId: 10 });
  assertEquals([amistar.status, amistar.product?.productId], ["found", 505]);
  const gold = await farm1.checkProductUse({ product: "amistar gold", fieldId: 10 });
  assertEquals(gold.product?.productId, 506);
});

Deno.test("product check: no match says so", async () => {
  const { farm1 } = await services();
  const c = ProductCheckSchema.parse(
    await farm1.checkProductUse({ product: "Roundup", fieldId: 10 }),
  );
  assertEquals(c.status, "not_found");
  assertEquals([c.product, c.matches, c.authorised, c.usage], [null, [], null, null]);
  // Too short or empty queries match nothing.
  const all = await farm1.checkProductUse({ product: "Karaté", fieldId: 10 });
  assertEquals(matchProducts(" - ", all.matches), []);
  assertEquals(matchProducts("ka", all.matches), []);
});

// ---- the verdict ----

Deno.test("product check: two uses on maize, used once, no applicationsLeft", async () => {
  const { farm1 } = await services();
  const c = ProductCheckSchema.parse(
    await farm1.checkProductUse({ product: "karate zeon", fieldId: 10 }),
  );
  assertEquals(c.date, TEST_TODAY);
  assertEquals([c.fieldId, c.fieldName], [10, "La Vallée"]);
  assertEquals(c.crop, {
    seasonId: 109,
    code: "MAIZ",
    name: "Maïs",
    sowingDate: "2026-04-16",
    harvestDate: "2026-10-17",
  });
  assertEquals(c.authorised, true);
  assertEquals(c.uses.map((u) => [u.target, u.maxDose, u.maxApplications, u.preHarvestOk]), [
    ["Chenilles phytophages", 0.15, 2, true],
    ["Pyrale(s) (1)", 0.2, 2, true],
  ]);
  assertEquals(c.usage, {
    timesUsed: 1,
    lastDate: "2026-06-25",
    applications: [{ date: "2026-06-25", dose: 0.15, doseUnit: "L/ha" }],
  });
  // Two uses: the limit depends on the target, so no subtraction.
  assertEquals(c.applicationsLeft, null);
  assertEquals([c.daysToHarvest, c.preHarvestOk], [104, true]);
  assertEquals(c.warnings, []);
});

Deno.test("product check: applicationsLeft counts this season's confirmed uses only", async () => {
  const { farm1 } = await services((f) =>
    f.operations!.push(
      spray(4001, "2026-06-01"),
      spray(4002, "2026-06-20", { status: "planned" }),
      spray(4003, "2026-06-22", { status: "draft" }),
      spray(4004, "2026-06-23", { status: "cancelled" }),
      // After the asked date, so not used yet on that day.
      spray(4005, "2026-07-03"),
      // Last season and another field.
      spray(4006, "2025-07-01", { seasonId: 99 }),
      spray(4007, "2026-06-02", { fieldId: 3, seasonId: 30 }),
    )
  );
  const c = ProductCheckSchema.parse(
    await farm1.checkProductUse({ product: "Decis Protech", fieldId: 10, date: "2026-07-02" }),
  );
  assertEquals(c.uses.length, 1);
  assertEquals(c.uses[0], {
    target: "Pyrale(s) (1)",
    maxDose: 0.83,
    doseUnit: "L/ha",
    maxApplications: 3,
    preHarvestIntervalDays: 30,
    bbchMin: null,
    bbchMax: null,
    bufferZoneWaterM: 20,
    conditions: null,
    preHarvestOk: true,
  });
  assertEquals(c.usage?.timesUsed, 1);
  assertEquals(c.usage?.lastDate, "2026-06-01");
  assertEquals(c.applicationsLeft, 2);
  assertEquals(c.warnings, []);
  // On 4 July, the 3 July spray counts too.
  const later = await farm1.checkProductUse({ product: "decis", fieldId: 10 });
  assertEquals([later.usage?.timesUsed, later.applicationsLeft], [2, 1]);
  assertEquals(later.usage?.applications.map((a) => a.date), ["2026-07-03", "2026-06-01"]);
});

Deno.test("product check: maximum reached or passed is a warning, never below 0", async () => {
  const { farm1 } = await services();
  const c = await farm1.checkProductUse({ product: "CALLISTO", fieldId: 10 });
  assertEquals([c.authorised, c.usage?.timesUsed, c.applicationsLeft], [true, 1, 0]);
  assert(c.warnings.includes("Maximum number of applications reached: 1 of 1 this season."));
  // BBCH is given, not checked.
  assert(
    c.warnings.includes(
      "Crop stage (BBCH) is not checked automatically: allowed from BBCH 12 to 19.",
    ),
    c.warnings.join(" | "),
  );
  assertEquals([c.uses[0].bbchMin, c.uses[0].bbchMax], [12, 19]);

  const { farm1: twice } = await services((f) =>
    f.operations!.push(
      spray(4010, "2026-06-05", { productId: 502, productName: "CALLISTO" }),
    )
  );
  const over = await twice.checkProductUse({ product: "CALLISTO", fieldId: 10 });
  assertEquals([over.usage?.timesUsed, over.applicationsLeft], [2, 0]);
  assert(
    over.warnings.includes("Used 2 times this season, more than the maximum of 1 application."),
  );
});

Deno.test("product check: preHarvestOk true, then false close to the harvest", async () => {
  const { farm1 } = await services();
  // DECIS PROTECH: 30 days before harvest (17 Oct).
  const early = await farm1.checkProductUse({ product: "decis", fieldId: 10, date: "2026-09-17" });
  assertEquals([early.daysToHarvest, early.preHarvestOk], [30, true]);
  const late = await farm1.checkProductUse({ product: "decis", fieldId: 10, date: "2026-09-18" });
  assertEquals([late.daysToHarvest, late.preHarvestOk, late.uses[0].preHarvestOk], [
    29,
    false,
    false,
  ]);
  assert(
    late.warnings.includes(
      "Pre-harvest interval not met: 30 days needed, only 29 days to harvest (2026-10-17).",
    ),
    late.warnings.join(" | "),
  );
  // KARATE ZEON: both uses need 7 days.
  const k = await farm1.checkProductUse({ product: "9800336", fieldId: 10, date: "2026-10-12" });
  assertEquals([k.daysToHarvest, k.preHarvestOk], [5, false]);
  assertEquals(k.uses.map((u) => u.preHarvestOk), [false, false]);
  // CALLISTO has no interval: no pre-harvest verdict.
  const c = await farm1.checkProductUse({ product: "callisto", fieldId: 10 });
  assertEquals([c.preHarvestOk, c.uses[0].preHarvestOk], [null, null]);
});

Deno.test("product check: uses that disagree on the interval give no pre-harvest verdict", async () => {
  const { farm1 } = await services((f) =>
    f.productUses!.push({
      ...f.productUses!.find((u) => u.productId === 503 && u.cropCode === "MAIZ")!,
      target: "Cicadelles",
      preHarvestIntervalDays: 60,
    })
  );
  const c = await farm1.checkProductUse({
    product: "karate zeon",
    fieldId: 10,
    date: "2026-09-01",
  });
  assertEquals(c.uses.map((u) => u.preHarvestOk), [true, true, false]);
  assertEquals(c.preHarvestOk, null);
  assert(c.warnings.some((w) => w.startsWith("The pre-harvest interval depends on the use")));
});

Deno.test("product check: no use for the crop = not authorised, with a warning", async () => {
  const { farm1 } = await services();
  // ELUMIS has a maize use only; Les Longues Raies grows rapeseed.
  const c = ProductCheckSchema.parse(
    await farm1.checkProductUse({ product: "Elumis", fieldId: 3 }),
  );
  assertEquals([c.status, c.crop?.name, c.authorised, c.uses], ["found", "Colza", false, []]);
  assertEquals(c.warnings, ["Not authorised: E-Phy lists no use of ELUMIS on Colza."]);
  assertEquals([c.applicationsLeft, c.preHarvestOk], [null, null]);
  assertEquals(c.usage?.timesUsed, 0);
  // The same product is authorised on the maize.
  assertEquals((await farm1.checkProductUse({ product: "Elumis", fieldId: 10 })).authorised, true);
});

Deno.test("product check: no crop on the date gives no verdict", async () => {
  const { farm1 } = await services();
  // Le Puits: the wheat is sown in October.
  const c = ProductCheckSchema.parse(
    await farm1.checkProductUse({ product: "karate zeon", fieldId: 11 }),
  );
  assertEquals([c.status, c.crop, c.authorised, c.usage, c.daysToHarvest], [
    "found",
    null,
    null,
    null,
    null,
  ]);
  assertEquals(c.warnings, [
    "Le Puits has no crop on 2026-07-05: the authorisation depends on the crop, so it cannot be checked.",
  ]);
});

Deno.test("product check: farm 2's synthetic product has no E-Phy data and no invented rules", async () => {
  const { farm2 } = await services();
  const c = ProductCheckSchema.parse(
    await farm2.checkProductUse({ product: "AS-HER-07", fieldId: 15 }),
  );
  assertEquals(c.status, "found");
  assertEquals(c.product, {
    productId: null,
    name: "Herbicide AS-HER-07 (synthetic)",
    ammNumber: null,
    kind: null,
    activeSubstances: null,
    synthetic: true,
  });
  assertEquals(c.crop?.name, "Maíz");
  assertEquals([c.authorised, c.uses, c.applicationsLeft, c.preHarvestOk], [null, [], null, null]);
  assertEquals(c.warnings, [NO_EPHY_DATA]);
  assert(NO_EPHY_DATA.includes("E-Phy covers France only"));
  // Its uses still come from farm 2's journal, by name.
  assertEquals(c.usage, {
    timesUsed: 1,
    lastDate: "2026-06-01",
    applications: [{ date: "2026-06-01", dose: 1, doseUnit: "L/ha" }],
  });
  // Farm 1 never sees farm 2's journal products.
  const { farm1 } = await services();
  assertEquals(
    (await farm1.checkProductUse({ product: "AS-HER-07", fieldId: 10 })).status,
    "not_found",
  );
});

Deno.test("product check: French rules are shown but are no verdict outside France", async () => {
  const { farm2 } = await services();
  const c = await farm2.checkProductUse({ product: "karate zeon", fieldId: 15 });
  assertEquals([c.status, c.uses.length], ["found", 2]);
  assertEquals([c.authorised, c.applicationsLeft, c.preHarvestOk], [null, null, null]);
  assertEquals(c.warnings, [
    "E-Phy covers France only: these French rules are not a verdict for this farm (ES).",
  ]);
});

const KZ = "KARATE AVEC TECHNOLOGIE ZEON";

Deno.test("product check: the usage count stays on the caller's farm", async () => {
  // Farm 2 sprayed KARATE ZEON twice on El Pozo; farm 1 once on La Vallée.
  const { farm1, farm2 } = await services(undefined, (f) =>
    f.operations!.push(
      spray(9101, "2026-06-10", { fieldId: 15, seasonId: 150, productId: 503, productName: KZ }),
      spray(9102, "2026-06-28", { fieldId: 15, seasonId: 150, productId: 503, productName: KZ }),
    ));
  const one = await farm1.checkProductUse({ product: "karate zeon", fieldId: 10 });
  assertEquals([one.usage?.timesUsed, one.usage?.lastDate], [1, "2026-06-25"]);
  const two = await farm2.checkProductUse({ product: "karate zeon", fieldId: 15 });
  assertEquals([two.usage?.timesUsed, two.usage?.lastDate], [2, "2026-06-28"]);
  // Farm 2 cannot check farm 1's field.
  const e = await assertRejects(
    () => farm2.checkProductUse({ product: "karate zeon", fieldId: 10 }),
    HTTPException,
  );
  assertEquals([e.status, e.message], [404, "field 10 not found"]);
});

Deno.test("product check: bad date, empty product and unknown field are refused", async () => {
  const { farm1 } = await services();
  for (
    const q of [{ product: "callisto", fieldId: 10, date: "2026-02-30" }, {
      product: " - ",
      fieldId: 10,
    }]
  ) {
    const e = await assertRejects(() => farm1.checkProductUse(q), HTTPException);
    assertEquals(e.status, 400, JSON.stringify(q));
  }
  const e = await assertRejects(
    () => farm1.checkProductUse({ product: "callisto", fieldId: 999 }),
    HTTPException,
  );
  assertEquals(e.status, 404);
});

// ---- Supabase: row mappers and queries ----

Deno.test("mappers: product, product use (numeric strings) and the farm's country", () => {
  assertEquals(
    mapProduct({
      id: 10,
      name: "KARATE AVEC TECHNOLOGIE ZEON",
      amm_number: "9800336",
      product_kind: "insecticide",
      active_substances: "lambda-cyhalothrine (Lambda-Cyhalothrin) 100.0 g/L",
    }),
    {
      id: 10,
      name: "KARATE AVEC TECHNOLOGIE ZEON",
      ammNumber: "9800336",
      kind: "insecticide",
      activeSubstances: "lambda-cyhalothrine (Lambda-Cyhalothrin) 100.0 g/L",
    },
  );
  assertEquals(
    mapProductUse({
      product_id: 10,
      crop_code: "MAIZ",
      target: "Pyrale(s) (1)",
      max_dose: "0.2",
      dose_unit: "L/ha",
      max_applications: 2,
      pre_harvest_interval_days: 7,
      bbch_min: null,
      bbch_max: null,
      buffer_zone_water_m: "50",
      conditions: null,
    }),
    {
      productId: 10,
      cropCode: "MAIZ",
      target: "Pyrale(s) (1)",
      maxDose: 0.2,
      doseUnit: "L/ha",
      maxApplications: 2,
      preHarvestIntervalDays: 7,
      bbchMin: null,
      bbchMax: null,
      bufferZoneWaterM: 50,
      conditions: null,
    },
  );
  assertEquals(mapFarm({ id: 2, name: "SAT Los Olmos", country_code: "ES" }).countryCode, "ES");
  assertEquals(mapFarm({ id: 9, name: "x" }).countryCode, null);
});

/** A fake Supabase client: records the tables and filters, answers `data` per table. */
function fakeDb(data: Record<string, unknown[]>, error: string | null = null) {
  const calls: [string, ...unknown[]][] = [];
  const db = {
    from: (table: string) => {
      calls.push(["from", table]);
      // deno-lint-ignore no-explicit-any
      const qb: any = {};
      for (const m of ["select", "eq", "is", "order", "range"]) {
        qb[m] = (...a: unknown[]) => (m === "range" || m === "order" || calls.push([m, ...a]), qb);
      }
      qb.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve({
          data: error ? null : data[table] ?? [],
          error: error ? { message: error } : null,
        })
          .then(res, rej);
      return qb;
    },
  };
  // deno-lint-ignore no-explicit-any
  return { db: db as any, calls };
}

Deno.test("supabase products: catalogue cached, uses by product, journal names by farm", async () => {
  const { db, calls } = fakeDb({
    product: [{ id: 10, name: "KARATE AVEC TECHNOLOGIE ZEON", amm_number: "9800336" }],
    product_use: [{ product_id: 10, crop_code: "MAIZ", max_dose: 0.2 }],
    operation_input: [
      { product_name: "Herbicide AS-HER-07 (synthetic)" },
      { product_name: "Herbicide AS-HER-07 (synthetic)" },
      { product_name: "Fungicide AS-FUN-04 (synthetic)" },
    ],
  });
  const d = createSupabaseFarmData(db, 2);

  assertEquals((await d.listProducts()).map((p) => p.name), ["KARATE AVEC TECHNOLOGIE ZEON"]);
  await d.listProducts();
  assertEquals(calls.filter((c) => c[0] === "from" && c[1] === "product").length, 1, "cached");
  assert(calls.every((c) => c[1] !== "farm_id"), "the catalogue is global");

  calls.length = 0;
  assertEquals((await d.listProductUses(10)).map((u) => [u.cropCode, u.maxDose]), [["MAIZ", 0.2]]);
  assertEquals(calls.filter((c) => c[0] !== "select"), [["from", "product_use"], [
    "eq",
    "product_id",
    10,
  ]]);

  calls.length = 0;
  assertEquals(await d.listJournalProductNames(), [
    "Herbicide AS-HER-07 (synthetic)",
    "Fungicide AS-FUN-04 (synthetic)",
  ]);
  assertEquals(calls, [
    ["from", "operation_input"],
    ["select", "product_name"],
    ["eq", "farm_id", 2],
    ["is", "product_id", null],
  ]);
});

Deno.test("supabase products: a failed catalogue read throws and is retried", async () => {
  const { db, calls } = fakeDb({}, "boom");
  const d = createSupabaseFarmData(db, 1);
  await assertRejects(() => d.listProducts(), HTTPException, "boom");
  await assertRejects(() => d.listProducts(), HTTPException, "boom");
  assertEquals(calls.filter((c) => c[0] === "from").length, 2, "not cached after a failure");
});
