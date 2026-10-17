// Field details and the farm journal (farmInfo.service.ts) on in-memory farms, plus the
// Supabase journal query and row mappers. No network, no database.

import { assert, assertEquals, assertRejects } from "@std/assert";
import { HTTPException } from "hono/http-exception";
import { FieldDetailsSchema, FieldJournalSchema } from "@tellia/shared/farm";
import type { FarmOperation } from "../src/modules/irrigation/data/farmData.ts";
import {
  createMemoryFarmData,
  type FarmFixture,
} from "../src/modules/irrigation/data/memoryFarmData.ts";
import {
  createSupabaseFarmData,
  mapCropSeason,
  mapFarmOperation,
  mapField,
  mapSoil,
} from "../src/modules/irrigation/data/supabaseFarmData.ts";
import { makeFarmFixture, makeSecondFarmFixture } from "./fixtures/farm.ts";
import { REEL_GUN } from "./fixtures/fao.ts";
import { makeTestRegistry, TEST_TODAY } from "./helpers/testApp.ts";

/** Farm 1's service; `edit` changes farm 1's fixture first. Farm 2 is the default one. */
async function services(edit?: (f: FarmFixture) => void) {
  const fx = makeFarmFixture();
  edit?.(fx);
  const registry = makeTestRegistry({
    farms: {
      1: createMemoryFarmData(fx),
      2: createMemoryFarmData(makeSecondFarmFixture()),
    },
  });
  return {
    farm1: (await registry.forFarm(1)).service,
    farm2: (await registry.forFarm(2)).service,
  };
}

const ids = (j: { entries: { operationId: number }[] }) => j.entries.map((e) => e.operationId);

// ---- getFieldDetails ----

Deno.test("getFieldDetails: field, crop today, full soil with its USDA class", async () => {
  const { farm1 } = await services();
  const d = FieldDetailsSchema.parse(await farm1.getFieldDetails(10));
  assertEquals(d.field, {
    id: 10,
    name: "La Vallée",
    areaHa: 12.5,
    tenure: "owned",
    irrigable: true,
  });
  assertEquals(d.crop, {
    seasonId: 109,
    code: "MAIZ",
    name: "Maïs",
    variety: "MAIZ-V03",
    earlinessGroup: null,
    sowingDate: "2026-04-16",
    harvestDate: "2026-10-17",
    status: "growing",
    previousCropName: "Blé tendre d'hiver",
  });
  assertEquals(d.irrigationSystem, null);
  assertEquals(d.soil, {
    sampledOn: "2024-09-10",
    textureClass: "Sandy loam",
    sandPct: 63.5,
    siltPct: 29.8,
    clayPct: 6.7,
    organicMatterPct: 5.11,
    ph: 6.4,
    nitrogenGKg: 1.6,
    phosphorusMgKg: 42.1,
    potassiumMgKg: 180.5,
    sulfurMgKg: 12.3,
    calciumMgKg: 1450,
    magnesiumMgKg: 120.4,
    zincMgKg: 2.1,
    boronMgKg: 0.6,
    cecCmolKg: 9.8,
    bulkDensityKgDm3: 1.42,
    limeRequirementTHa: 0,
  });
});

Deno.test("getFieldDetails: irrigation system; no crop today; partial or missing soil", async () => {
  const { farm1 } = await services((f) => (f.irrigationSystems = { 10: REEL_GUN }));
  assertEquals((await farm1.getFieldDetails(10)).irrigationSystem, {
    name: "Reel gun 1",
    type: "reel_gun",
    efficiency: 0.75,
    doseMinMm: 20,
    doseMaxMm: 40,
    roundDays: 3,
  });
  // Le Puits: the wheat is sown in October, nothing grows on TEST_TODAY.
  const puits = FieldDetailsSchema.parse(await farm1.getFieldDetails(11));
  assertEquals(puits.crop, null);
  assertEquals(puits.field.tenure, "rented");
  assertEquals(puits.soil?.textureClass, "Clay loam");
  assertEquals(puits.soil?.sampledOn, null);
  assertEquals(puits.soil?.ph, null);
  // Les Longues Raies: rapeseed growing, no soil analysis, no previous crop.
  const raies = await farm1.getFieldDetails(3);
  assertEquals(raies.soil, null);
  assertEquals(raies.crop?.name, "Colza");
  assertEquals(raies.crop?.previousCropName, null);
});

Deno.test("getFieldDetails: unknown field is a 404", async () => {
  const { farm1 } = await services();
  const e = await assertRejects(() => farm1.getFieldDetails(999), HTTPException);
  assertEquals(e.status, 404);
});

// ---- getFieldJournal ----

Deno.test("journal: default range is the field's season; newest first; totals; planned", async () => {
  const { farm1 } = await services();
  const j = FieldJournalSchema.parse(await farm1.getFieldJournal({ fieldId: 10 }));
  assertEquals([j.fieldId, j.fieldName, j.type, j.from, j.to], [
    10,
    "La Vallée",
    null,
    "2026-04-16",
    "2026-10-17",
  ]);
  // Tillage (before sowing), the draft and the cancelled spray are left out.
  assertEquals(ids(j), [1008, 1007, 1006, 1, 1004, 1005, 1003, 1002]);
  assertEquals(j.truncated, false);
  assertEquals(j.totals, {
    count: 7,
    byType: { sowing: 1, fertilisation: 2, spraying: 2, irrigation: 1, observation: 1 },
    nKgHa: 110,
    p2o5KgHa: 40,
    k2oKgHa: 60,
    irrigationMm: 30,
    sprays: 2,
    planned: 1,
  });

  const harvest = j.entries[0];
  assertEquals([harvest.type, harvest.status, harvest.planned], ["harvest", "planned", true]);
  assert(j.entries.slice(1).every((e) => !e.planned && e.status === "confirmed"));

  const fert = j.entries.find((e) => e.operationId === 1003)!;
  assertEquals(fert, {
    operationId: 1003,
    date: "2026-05-20",
    type: "fertilisation",
    fieldId: 10,
    fieldName: "La Vallée",
    status: "confirmed",
    planned: false,
    bbch: 14,
    fertiliserType: "mineral",
    nKgHa: 60,
    p2o5KgHa: 40,
    k2oKgHa: 60,
    method: "broadcast",
    products: [],
  });
  const spray = j.entries.find((e) => e.operationId === 1005)!;
  assertEquals(spray.products, [
    { productName: "ELUMIS", dose: 1.25, doseUnit: "L/ha", target: "Weeds" },
    { productName: "CALLISTO", dose: 0.75, doseUnit: "L/ha", target: "Weeds" },
  ]);
  const water = j.entries.find((e) => e.type === "irrigation")!;
  assertEquals(water.waterMm, 30);
  assert(!("nKgHa" in water), "values that do not apply are left out");
});

Deno.test("journal: drafts and cancelled rows never show, a confirmed irrigation does", async () => {
  const { farm1 } = await services();
  const draft = await farm1.createDraftIrrigation({
    fieldId: 10,
    date: "2026-07-04",
    mm: 22,
    memberId: 1,
  });
  const before = await farm1.getFieldJournal({ fieldId: 10 });
  assert(!ids(before).includes(draft.operationId));
  assert(!ids(before).includes(1010) && !ids(before).includes(1011));
  assertEquals(before.totals.irrigationMm, 30);
  await farm1.confirmIrrigation(draft.operationId);
  const after = await farm1.getFieldJournal({ fieldId: 10 });
  assert(ids(after).includes(draft.operationId));
  assertEquals(after.totals.irrigationMm, 52);
});

Deno.test("journal: from/to and type filters; totals follow the filters", async () => {
  const { farm1 } = await services();
  const spring = await farm1.getFieldJournal({
    fieldId: 10,
    from: "2026-04-01",
    to: "2026-06-15",
  });
  assertEquals(ids(spring), [1004, 1005, 1003, 1002, 1001]);
  assertEquals(spring.totals.count, 5);
  assertEquals(spring.totals.byType.tillage, 1);
  assertEquals(spring.totals.irrigationMm, 0);
  assertEquals(spring.totals.planned, 0);

  const sprays = await farm1.getFieldJournal({ fieldId: 10, type: "spraying" });
  assertEquals(sprays.type, "spraying");
  assertEquals(ids(sprays), [1006, 1005]);
  assertEquals(sprays.totals.byType, { spraying: 2 });
  assertEquals(sprays.totals.sprays, 2);
  assertEquals(sprays.totals.nKgHa, 0);
});

Deno.test("journal: no field = last 365 days to today + 30; kg/ha sums need one field", async () => {
  const { farm1 } = await services();
  const j = FieldJournalSchema.parse(await farm1.getFieldJournal());
  assertEquals([j.fieldId, j.fieldName, j.from, j.to], [null, null, "2025-07-05", "2026-08-04"]);
  // La Vallée's planned harvest (10 Oct) is after the range; the rapeseed harvest is in it.
  assertEquals(ids(j), [1022, 1007, 1006, 1, 1004, 1005, 1003, 1002, 1001, 1021, 1020]);
  assertEquals(j.entries[0].fieldName, "Les Longues Raies");
  assertEquals(j.totals.count, 10);
  assertEquals(j.totals.planned, 1);
  assertEquals(j.totals.sprays, 2);
  assertEquals(j.totals.byType.fertilisation, 3);
  // kg/ha and mm cannot be added across fields.
  assertEquals([j.totals.nKgHa, j.totals.p2o5KgHa, j.totals.k2oKgHa, j.totals.irrigationMm], [
    null,
    null,
    null,
    null,
  ]);
  // A field with no crop today gets the same default range.
  const puits = await farm1.getFieldJournal({ fieldId: 11 });
  assertEquals([puits.from, puits.to, puits.entries.length], ["2025-07-05", "2026-08-04", 0]);
  assertEquals(puits.totals.nKgHa, 0);
});

Deno.test("journal: at most 20 entries, truncated, totals over the whole range", async () => {
  const extra: FarmOperation[] = Array.from({ length: 25 }, (_, i) => ({
    operationId: 2000 + i,
    fieldId: 10,
    seasonId: 109,
    date: `2026-05-${String(i + 1).padStart(2, "0")}`,
    type: "observation",
    status: "confirmed",
    notes: `walk ${i + 1}`,
    products: [],
  }));
  const { farm1 } = await services((f) => f.operations!.push(...extra));
  const j = FieldJournalSchema.parse(await farm1.getFieldJournal({ fieldId: 10 }));
  assertEquals(j.entries.length, 20);
  assertEquals(j.truncated, true);
  assertEquals(j.entries[0].operationId, 1008);
  assertEquals(j.totals.count, 32);
  assertEquals(j.totals.byType.observation, 26);
  assertEquals(j.totals.nKgHa, 110);
  // Exactly 20 is not truncated.
  const { farm1: exact } = await services((f) => f.operations!.push(...extra.slice(0, 20 - 8)));
  const full = await exact.getFieldJournal({ fieldId: 10 });
  assertEquals([full.entries.length, full.truncated], [20, false]);
});

Deno.test("journal: a confirmed row dated after today is planned and left out of the totals", async () => {
  const fert = (operationId: number, date: string, nKgHa: number): FarmOperation => ({
    operationId,
    fieldId: 10,
    seasonId: 109,
    date,
    type: "fertilisation",
    status: "confirmed",
    nKgHa,
    products: [],
  });
  const { farm1 } = await services((f) =>
    f.operations!.push(fert(3000, "2026-07-20", 40), fert(3001, TEST_TODAY, 10))
  );
  const j = await farm1.getFieldJournal({ fieldId: 10 });
  const later = j.entries.find((e) => e.operationId === 3000)!;
  assertEquals([later.status, later.planned], ["confirmed", true]);
  // Today itself is done.
  assertEquals(j.entries.find((e) => e.operationId === 3001)!.planned, false);
  assertEquals(j.totals.nKgHa, 120);
  assertEquals(j.totals.planned, 2);
});

Deno.test("journal: bad dates, from after to and unknown field are refused", async () => {
  const { farm1 } = await services();
  for (
    const q of [
      { fieldId: 10, from: "2026-02-30" },
      { fieldId: 10, to: "2026/07/01" },
      { fieldId: 10, from: "2026-08-01", to: "2026-07-01" },
      // Only `to`, before the season's sowing: the range would be upside down.
      { fieldId: 10, to: "2026-03-01" },
    ]
  ) {
    const e = await assertRejects(() => farm1.getFieldJournal(q), HTTPException);
    assertEquals(e.status, 400, JSON.stringify(q));
  }
  const e = await assertRejects(() => farm1.getFieldJournal({ fieldId: 999 }), HTTPException);
  assertEquals(e.status, 404);
});

Deno.test("farm scoping: farm 2 cannot read farm 1's field and sees only its own journal", async () => {
  const { farm2 } = await services();
  for (
    const call of [() => farm2.getFieldDetails(10), () => farm2.getFieldJournal({ fieldId: 10 })]
  ) {
    const e = await assertRejects(call, HTTPException);
    assertEquals(e.status, 404);
    assertEquals(e.message, "field 10 not found");
  }
  const j = await farm2.getFieldJournal();
  assertEquals(ids(j), [900, 9003, 9002, 9001]);
  assert(j.entries.every((e) => e.fieldId === 15 && e.fieldName === "El Pozo"));
  assertEquals(j.totals.nKgHa, 90);
  assertEquals(j.totals.irrigationMm, 25);
  assertEquals(j.entries[1].products[0].productName, "Herbicide AS-HER-07 (synthetic)");
  const d = await farm2.getFieldDetails(15);
  assertEquals([d.crop?.name, d.field.tenure], ["Maíz", null]);
});

// ---- Supabase: row mappers and the journal query ----

Deno.test("mappers: journal row with products, full soil, tenure, variety and previous crop", () => {
  const op = mapFarmOperation({
    id: "58",
    field_id: 2,
    crop_season_id: 12,
    op_date: "2016-10-25",
    op_type: "spraying",
    status: "confirmed",
    bbch: 13,
    fertiliser_type: null,
    n_kg_ha: null,
    water_mm: null,
    notes: "autumn aphids",
    operation_input: [
      {
        product_id: 11,
        product_name: "DECIS PROTECH",
        dose: 0.25,
        dose_unit: "L/ha",
        target: "Pucerons",
      },
    ],
  });
  assertEquals(op.operationId, 58);
  assertEquals([op.type, op.status, op.bbch, op.nKgHa, op.notes], [
    "spraying",
    "confirmed",
    13,
    null,
    "autumn aphids",
  ]);
  assertEquals(op.products, [
    {
      productId: 11,
      productName: "DECIS PROTECH",
      dose: 0.25,
      doseUnit: "L/ha",
      target: "Pucerons",
    },
  ]);
  assertEquals(mapFarmOperation({ id: 1, op_type: "sowing", status: "planned" }).products, []);

  const soil = mapSoil({
    sampled_on: "2024-09-10",
    ph_h2o: 5.5,
    organic_matter_pct: 7.45,
    nitrogen_g_kg: 3.4,
    sand_pct: 17.5,
    silt_pct: 55.2,
    clay_pct: 27.4,
    lime_requirement_t_ha: "0.64",
  });
  assertEquals([soil.sampledOn, soil.ph, soil.siltPct, soil.limeRequirementTHa, soil.zincMgKg], [
    "2024-09-10",
    5.5,
    55.2,
    0.64,
    null,
  ]);
  assertEquals(
    mapField({ id: 1, name: "Le Moulin", area_ha: 8.37, tenure: "owned" }).tenure,
    "owned",
  );
  const season = mapCropSeason({
    id: 1,
    crop_code: "COWT",
    sowing_date: "2016-11-01",
    harvest_date: "2017-08-02",
    status: "harvested",
    variety: "COWT-V09",
    previous_crop_code: "SUNF",
  });
  assertEquals([season.variety, season.previousCropCode], ["COWT-V09", "SUNF"]);
});

Deno.test("supabase listOperations: farm, products, status, field, type and dates filtered", async () => {
  const calls: [string, ...unknown[]][] = [];
  let selected = "";
  // deno-lint-ignore no-explicit-any
  const qb: any = {
    select: (s: string) => ((selected = s), qb),
    eq: (...a: unknown[]) => (calls.push(["eq", ...a]), qb),
    in: (...a: unknown[]) => (calls.push(["in", ...a]), qb),
    gte: (...a: unknown[]) => (calls.push(["gte", ...a]), qb),
    lte: (...a: unknown[]) => (calls.push(["lte", ...a]), qb),
    order: () => qb,
    range: () => qb,
    then: (res: (v: unknown) => unknown) =>
      res({
        data: [{
          id: 5,
          field_id: 10,
          op_date: "2026-05-28",
          op_type: "spraying",
          status: "confirmed",
        }],
        error: null,
      }),
  };
  const tables: string[] = [];
  // deno-lint-ignore no-explicit-any
  const d = createSupabaseFarmData({ from: (t: string) => (tables.push(t), qb) } as any, 2);
  const rows = await d.listOperations({
    from: "2026-04-16",
    to: "2026-10-17",
    fieldId: 15,
    type: "spraying",
  });
  assertEquals(rows.map((r) => r.operationId), [5]);
  assertEquals(tables, ["operation"]);
  assert(selected.includes("operation_input(product_id,product_name,dose,dose_unit,target)"));
  assertEquals(calls, [
    ["eq", "farm_id", 2],
    ["eq", "operation_input.farm_id", 2],
    ["in", "status", ["confirmed", "planned"]],
    ["gte", "op_date", "2026-04-16"],
    ["lte", "op_date", "2026-10-17"],
    ["eq", "field_id", 15],
    ["eq", "op_type", "spraying"],
  ]);
  // No field and no type: only the farm, status and dates.
  calls.length = 0;
  await d.listOperations({ from: "2026-01-01", to: "2026-12-31" });
  assertEquals(calls.map((c) => c[1]), [
    "farm_id",
    "operation_input.farm_id",
    "status",
    "op_date",
    "op_date",
  ]);
});
