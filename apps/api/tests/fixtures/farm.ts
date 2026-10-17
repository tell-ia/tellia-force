import type { FarmFixture } from "../../src/modules/irrigation/data/memoryFarmData";
import { addDays } from "../../src/modules/irrigation/engine/util";

const MAIZE_KC: [number, number][] = [
  [0, .3],
  [.05, .3],
  [.22, .37],
  [.30, .66],
  [.47, 1.2],
  [.52, 1.2],
  [.60, 1.2],
  [.70, 1.2],
  [.85, .86],
  [.93, .59],
  [1, .35],
];

function constantWeather(from: string, to: string, et0 = 5) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push({
      date: d,
      et0,
      rain: 0,
      tmin: 12,
      tmean: 20,
      gddBase0: 20,
      gddBase5: 15,
      gddBase6: 14,
      gddBase10: 10,
    });
  }
  return out;
}

function constantClimatology(value: number) {
  const out: Record<string, number> = {};
  for (let d = "2025-01-01"; d <= "2025-12-31"; d = addDays(d, 1)) out[d.slice(5)] = value;
  return out;
}

/** Realistic farm mirroring the real DB (GAEC des Trois Chênes). */
export function makeFarmFixture(): FarmFixture {
  return {
    farm: { id: 1, name: "GAEC des Trois Chênes", lat: 48.046, lon: 1.794 },
    members: [
      { id: 1, name: "Claire Lefèvre", language: "fr", mainContact: true },
      { id: 2, name: "Thomas Lefèvre", language: "fr", mainContact: false },
    ],
    fields: [
      {
        id: 10,
        name: "La Vallée",
        areaHa: 12.5,
        irrigable: true,
        centroid: { lat: 48.046, lon: 1.794 },
        tenure: "owned",
      },
      {
        id: 11,
        name: "Le Puits",
        areaHa: 8.2,
        irrigable: true,
        centroid: { lat: 48.05, lon: 1.79 },
        tenure: "rented",
      },
      {
        id: 3,
        name: "Les Longues Raies",
        areaHa: 15,
        irrigable: false,
        centroid: null,
        tenure: "owned",
      },
    ],
    seasons: {
      10: [{
        id: 109,
        cropCode: "MAIZ",
        sowingDate: "2026-04-16",
        harvestDate: "2026-10-17",
        status: "growing",
        variety: "MAIZ-V03",
        previousCropCode: "COWT",
      }],
      11: [{
        id: 121,
        cropCode: "COWT",
        sowingDate: "2026-10-09",
        harvestDate: "2027-07-15",
        status: "growing",
      }],
      3: [{
        id: 30,
        cropCode: "RAPE",
        sowingDate: "2025-08-24",
        harvestDate: "2026-07-22",
        status: "growing",
      }],
    },
    soils: {
      // Full analysis: the engine reads sand, clay and organic matter only.
      10: {
        sandPct: 63.5,
        clayPct: 6.7,
        organicMatterPct: 5.11,
        sampledOn: "2024-09-10",
        siltPct: 29.8,
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
      },
      11: { sandPct: 30.6, clayPct: 28.3, organicMatterPct: 0.95 },
    },
    cropRefs: [
      {
        code: "MAIZ",
        nameFr: "Maïs",
        nameEn: "Maize",
        names: { fr: "Maïs", en: "Maize", es: "Maíz", it: "Mais" },
        gddBaseC: 6,
        kcIni: .3,
        kcMid: 1.2,
        kcEnd: .35,
      },
      {
        code: "COWT",
        nameFr: "Blé tendre d'hiver",
        nameEn: "Common winter wheat",
        names: { fr: "Blé tendre d'hiver", en: "Common winter wheat" },
        gddBaseC: 0,
        kcIni: .4,
        kcMid: 1.15,
        kcEnd: .4,
      },
      {
        code: "RAPE",
        nameFr: "Colza",
        nameEn: "Rapeseed",
        names: { fr: "Colza", en: "Rapeseed" },
        gddBaseC: 0,
        kcIni: .35,
        kcMid: 1.15,
        kcEnd: .35,
      },
    ],
    cropStages: {
      MAIZ: MAIZE_KC.map(([seasonFraction, kc]) => ({ seasonFraction, kc })),
    },
    weather: constantWeather("2026-04-01", "2026-07-15"),
    climatology: { 0: constantClimatology(20), 6: constantClimatology(14) },
    irrigations: [{
      operationId: 1,
      fieldId: 10,
      seasonId: 109,
      date: "2026-06-21",
      mm: 30,
      status: "confirmed",
      source: "import",
      memberId: null,
    }],
    operations: farm1Journal(),
  };
}

/**
 * Farm 1's journal besides irrigations. La Vallée's maize season (16 Apr – 17 Oct 2026) has
 * 6 done rows here plus the 30 mm irrigation: N 110, P2O5 40, K2O 60 kg/ha, 2 sprays. The
 * tillage is before sowing, the harvest is planned after TEST_TODAY (2026-07-05), and the
 * draft and the cancelled spray must never show.
 */
function farm1Journal(): NonNullable<FarmFixture["operations"]> {
  const base = { status: "confirmed" as const, products: [] };
  return [
    {
      ...base,
      operationId: 1001,
      fieldId: 10,
      seasonId: null,
      date: "2026-04-02",
      type: "tillage",
      method: "ploughing",
    },
    {
      ...base,
      operationId: 1002,
      fieldId: 10,
      seasonId: 109,
      date: "2026-04-16",
      type: "sowing",
      bbch: 0,
      variety: "MAIZ-V03",
      seedRateKgHa: 25,
    },
    {
      ...base,
      operationId: 1003,
      fieldId: 10,
      seasonId: 109,
      date: "2026-05-20",
      type: "fertilisation",
      bbch: 14,
      fertiliserType: "mineral",
      nKgHa: 60,
      p2o5KgHa: 40,
      k2oKgHa: 60,
      method: "broadcast",
    },
    {
      ...base,
      operationId: 1005,
      fieldId: 10,
      seasonId: 109,
      date: "2026-05-28",
      type: "spraying",
      bbch: 15,
      notes: "weeds after rain",
      products: [
        { productId: 501, productName: "ADENGO", dose: 0.33, doseUnit: "L/ha", target: "Weeds" },
        { productId: 502, productName: "CALLISTO", dose: 0.75, doseUnit: "L/ha", target: "Weeds" },
      ],
    },
    {
      ...base,
      operationId: 1004,
      fieldId: 10,
      seasonId: 109,
      date: "2026-06-10",
      type: "fertilisation",
      bbch: 32,
      fertiliserType: "mineral",
      nKgHa: 50,
      method: "broadcast",
    },
    {
      ...base,
      operationId: 1006,
      fieldId: 10,
      seasonId: 109,
      date: "2026-06-25",
      type: "spraying",
      bbch: 51,
      products: [{
        productId: 503,
        productName: "KARATE AVEC TECHNOLOGIE ZEON",
        dose: 0.15,
        doseUnit: "L/ha",
        target: "Corn borer",
      }],
    },
    {
      ...base,
      operationId: 1007,
      fieldId: 10,
      seasonId: 109,
      date: "2026-06-30",
      type: "observation",
      notes: "Corn borer eggs on the leaves",
    },
    {
      ...base,
      operationId: 1010,
      fieldId: 10,
      seasonId: 109,
      date: "2026-07-01",
      type: "spraying",
      status: "draft",
    },
    {
      ...base,
      operationId: 1011,
      fieldId: 10,
      seasonId: 109,
      date: "2026-07-02",
      type: "spraying",
      status: "cancelled",
    },
    {
      ...base,
      operationId: 1008,
      fieldId: 10,
      seasonId: 109,
      date: "2026-10-10",
      type: "harvest",
      status: "planned",
    },
    // Les Longues Raies (rapeseed, 24 Aug 2025 – 22 Jul 2026).
    {
      ...base,
      operationId: 1020,
      fieldId: 3,
      seasonId: 30,
      date: "2025-08-24",
      type: "sowing",
      variety: "RAPE-V02",
      seedRateKgHa: 3,
    },
    {
      ...base,
      operationId: 1021,
      fieldId: 3,
      seasonId: 30,
      date: "2026-02-20",
      type: "fertilisation",
      fertiliserType: "organic",
      nKgHa: 80,
    },
    {
      ...base,
      operationId: 1022,
      fieldId: 3,
      seasonId: 30,
      date: "2026-07-20",
      type: "harvest",
      status: "planned",
    },
  ];
}

/**
 * A second farm sharing the DB (SAT Los Olmos, Valladolid, Spanish). Its region is hotter
 * (ET0 7 vs 5), so any weather or data leaking across farms changes the numbers.
 * Ids never overlap with farm 1.
 */
export function makeSecondFarmFixture(): FarmFixture {
  const farm1 = makeFarmFixture();
  return {
    farm: { id: 2, name: "SAT Los Olmos", lat: 41.6, lon: -4.92 },
    members: [
      { id: 5, name: "Elena Martín", language: "es", mainContact: true },
      { id: 6, name: "Javier Martín", language: "es", mainContact: false },
    ],
    fields: [
      {
        id: 15,
        name: "El Pozo",
        areaHa: 9.4,
        irrigable: true,
        centroid: { lat: 41.6, lon: -4.92 },
      },
    ],
    seasons: {
      15: [{
        id: 150,
        cropCode: "MAIZ",
        sowingDate: "2026-04-16",
        harvestDate: "2026-10-17",
        status: "growing",
      }],
    },
    soils: { 15: { sandPct: 63.5, clayPct: 6.7, organicMatterPct: 5.11 } },
    cropRefs: farm1.cropRefs,
    cropStages: farm1.cropStages,
    weather: constantWeather("2026-04-01", "2026-07-15", 7),
    climatology: farm1.climatology,
    irrigations: [{
      operationId: 900,
      fieldId: 15,
      seasonId: 150,
      date: "2026-06-20",
      mm: 25,
      status: "confirmed",
      source: "import",
      memberId: null,
    }],
    // Its own journal: N 90 kg/ha and one spray with a synthetic product.
    operations: [
      {
        operationId: 9001,
        fieldId: 15,
        seasonId: 150,
        date: "2026-04-16",
        type: "sowing",
        status: "confirmed",
        variety: "MAIZ-V07",
        products: [],
      },
      {
        operationId: 9002,
        fieldId: 15,
        seasonId: 150,
        date: "2026-05-15",
        type: "fertilisation",
        status: "confirmed",
        nKgHa: 90,
        p2o5KgHa: 30,
        products: [],
      },
      {
        operationId: 9003,
        fieldId: 15,
        seasonId: 150,
        date: "2026-06-01",
        type: "spraying",
        status: "confirmed",
        products: [{
          productId: null,
          productName: "Herbicida A",
          dose: 1,
          doseUnit: "L/ha",
          target: "Malas hierbas",
        }],
      },
    ],
  };
}
