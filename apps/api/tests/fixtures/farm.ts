import type {
  FarmEconomicsRecord,
  MarketPriceRecord,
  Product,
  ProductUse,
  RegionalBenchmarkRecord,
  SaleRecord,
} from "../../src/modules/irrigation/data/farmData";
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
    farm: { id: 1, name: "GAEC des Trois Chênes", lat: 48.046, lon: 1.794, countryCode: "FR" },
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
        cropGroupCode: "LMAIZ",
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
        cropGroupCode: "CERE",
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
        cropGroupCode: "LRAPE",
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
    // Copies: tests may edit a fixture without leaking into the next one.
    products: structuredClone(PRODUCTS),
    productUses: structuredClone(PRODUCT_USES),
    // Business tables (lookupFarmData). 2024 harvest: wheat 100 t for 22 400 EUR (224 EUR/t),
    // maize 50 t for 10 500 EUR.
    sales: [
      sale(1, "2024-08-20", "COWT", 2024, 60, 240, "COOPERATIVE"),
      sale(2, "2025-01-06", "COWT", 2024, 40, 200, "FORWARD"),
      sale(3, "2024-10-14", "MAIZ", 2024, 50, 210, "COOPERATIVE"),
      sale(4, "2025-08-18", "COWT", 2025, 30, 220, "COOPERATIVE"),
      sale(5, "2025-07-28", "RAPE", 2025, 20, 450.5, "COOPERATIVE"),
    ],
    marketPrices: structuredClone(MARKET_PRICES),
    subsidies: [
      { id: 1, year: 2025, scheme: "BISS", amountEur: 11380.12 },
      { id: 2, year: 2025, scheme: "ECO_SCHEME", amountEur: 5596.06 },
      { id: 3, year: 2026, scheme: "BISS", amountEur: 10358.6 },
      { id: 4, year: 2026, scheme: "CRISS", amountEur: 1987.45 },
    ],
    farmEconomics: [
      economics(2025, 106466.67, 54028.12, 78449.9),
      economics(2026, 99035.7, 42126.93, 84998.63),
    ],
    // Region FRB06 (Loiret), real values from the DB.
    regionalBenchmarks: [
      benchmark("CERE", "Cereals excluding maize and rice", 2020, 5.13, 144.4),
      benchmark("LMAIZ", "Maize", 2020, 15.99, 147.53),
      benchmark("CERE", "Cereals excluding maize and rice", 2019, 7.2, 151.2),
    ],
  };
}

const sale = (
  id: number,
  date: string,
  cropCode: string,
  harvestYear: number,
  volumeT: number,
  priceEurT: number,
  contractType: string,
): SaleRecord => ({
  id,
  date,
  cropCode,
  harvestYear,
  volumeT,
  priceEurT,
  buyer: `BUYER-0${id}`,
  contractType,
  qualityGrade: "B",
});

/**
 * Monthly reference prices (global): wheat every month of 2025 and 2026 (200 + month number,
 * plus 20 in 2026), maize June to September 2026. 28 rows.
 */
export const MARKET_PRICES: MarketPriceRecord[] = [
  ...[2025, 2026].flatMap((year) =>
    Array.from({ length: 12 }, (_, i) => ({
      cropCode: "COWT",
      year,
      month: i + 1,
      priceEurT: 200 + i + 1 + (year === 2026 ? 20 : 0),
    }))
  ),
  ...[6, 7, 8, 9].map((month) => ({
    cropCode: "MAIZ",
    year: 2026,
    month,
    priceEurT: 184 + month,
  })),
];

const economics = (
  year: number,
  totalOutputEur: number,
  totalInputsEur: number,
  farmNetValueAddedEur: number,
): FarmEconomicsRecord => ({
  year,
  totalOutputEur,
  seedsEur: 3677.54,
  fertiliserEur: 11338.07,
  cropProtectionEur: 3710.3,
  energyEur: 6800.09,
  contractWorkEur: 4605.83,
  wagesEur: 2394.15,
  depreciationEur: 9600.95,
  totalInputsEur,
  farmNetValueAddedEur,
});

const benchmark = (
  cropGroupCode: string,
  cropGroupName: string,
  year: number,
  yieldTHa: number,
  nKgHa: number,
): RegionalBenchmarkRecord => ({
  cropGroupCode,
  cropGroupName,
  year,
  yieldTHa,
  yieldSourceGeography: null,
  yieldValueType: "regional_proxy",
  nKgHa,
  p2o5KgHa: 20,
  k2oKgHa: 15,
  npkReferenceYear: year,
  irrigatedShare: 0.34,
  pesticideTotalKgAiHa: 0.4,
  herbicideKgAiHa: 0.24,
  fungicideKgAiHa: 0.14,
  insecticideKgAiHa: 0.02,
  pesticideReference: "2018 median scenario",
});

const product = (
  id: number,
  name: string,
  ammNumber: string,
  kind: string,
  activeSubstances: string,
): Product => ({ id, name, ammNumber, kind, activeSubstances });

/**
 * E-Phy catalogue (global): real products, AMM numbers and uses copied from the DB, with test
 * ids (501-507). ELUMIS, CALLISTO and KARATE ZEON are in farm 1's journal on La Vallée.
 */
export const PRODUCTS: Product[] = [
  product(501, "ELUMIS", "2100111", "herbicide", "mésotrione 75.0 g/L | nicosulfuron 30.0 g/L"),
  product(502, "CALLISTO", "9900047", "herbicide", "mésotrione 100.0 g/L"),
  product(
    503,
    "KARATE AVEC TECHNOLOGIE ZEON",
    "9800336",
    "insecticide",
    "lambda-cyhalothrine 100.0 g/L",
  ),
  product(504, "DECIS PROTECH", "2010023", "insecticide", "deltaméthrine 15.0 g/L"),
  product(505, "AMISTAR", "9600093", "fungicide", "azoxystrobine 250.0 g/L"),
  product(
    506,
    "AMISTAR GOLD",
    "2160724",
    "fungicide",
    "difénoconazole 125.0 g/L | azoxystrobine 125.0 g/L",
  ),
  product(
    507,
    "KARATE K",
    "8800395",
    "insecticide",
    "pirimicarbe 100.0 g/L | lambda-cyhalothrine 5.0 g/L",
  ),
];

const use = (u: Partial<ProductUse> & Pick<ProductUse, "productId" | "cropCode">): ProductUse => ({
  target: null,
  maxDose: null,
  doseUnit: "L/ha",
  maxApplications: null,
  preHarvestIntervalDays: null,
  bbchMin: null,
  bbchMax: null,
  bufferZoneWaterM: null,
  conditions: null,
  ...u,
});

/**
 * E-Phy uses (global). On maize: ELUMIS, CALLISTO and DECIS PROTECH have one use each (DECIS:
 * 3 applications, 30 days before harvest); KARATE ZEON has two uses (7 days before harvest).
 * ELUMIS has no rapeseed use: not authorised on Les Longues Raies.
 */
export const PRODUCT_USES: ProductUse[] = [
  use({
    productId: 501,
    cropCode: "MAIZ",
    target: "Désherbage",
    maxDose: 1.5,
    maxApplications: 1,
    bbchMin: 12,
    bbchMax: 19,
    bufferZoneWaterM: 5,
    conditions: "Uniquement sur maïs, millet, miscanthus et moha.",
  }),
  use({
    productId: 502,
    cropCode: "MAIZ",
    target: "Désherbage",
    maxDose: 1.5,
    maxApplications: 1,
    bbchMin: 12,
    bbchMax: 19,
    bufferZoneWaterM: 5,
    conditions:
      "Uniquement sur maïs, millet, miscanthus, moha. Fractionnement possible en 2 applications à la dose maximale de 0,75 L/ha, en respectant un intervalle minimum entre applications de 12 jours.",
  }),
  use({
    productId: 502,
    cropCode: "RAPE",
    target: "Désherbage",
    maxDose: 0.15,
    maxApplications: 2,
    bbchMin: 16,
    bbchMax: 19,
    bufferZoneWaterM: 5,
  }),
  use({
    productId: 503,
    cropCode: "MAIZ",
    target: "Chenilles phytophages",
    maxDose: 0.15,
    maxApplications: 2,
    preHarvestIntervalDays: 7,
    bufferZoneWaterM: 50,
    conditions:
      "F : Emploi autorisé durant la floraison en dehors de la présence d'abeilles pour une application par culture à la dose maximum revendiquée pour l'usage.",
  }),
  use({
    productId: 503,
    cropCode: "MAIZ",
    target: "Pyrale(s) (1)",
    maxDose: 0.2,
    maxApplications: 2,
    preHarvestIntervalDays: 7,
    bufferZoneWaterM: 50,
  }),
  use({
    productId: 503,
    cropCode: "RAPE",
    target: "Pucerons",
    maxDose: 0.075,
    maxApplications: 3,
    preHarvestIntervalDays: 35,
    bufferZoneWaterM: 50,
  }),
  use({
    productId: 504,
    cropCode: "MAIZ",
    target: "Pyrale(s) (1)",
    maxDose: 0.83,
    maxApplications: 3,
    preHarvestIntervalDays: 30,
    bufferZoneWaterM: 20,
  }),
  use({
    productId: 504,
    cropCode: "RAPE",
    target: "Pucerons",
    maxDose: 0.42,
    maxApplications: 4,
    preHarvestIntervalDays: 45,
    bufferZoneWaterM: 20,
  }),
  use({
    productId: 505,
    cropCode: "MAIZ",
    target: "Rouille(s)",
    maxDose: 1,
    maxApplications: 2,
    bbchMax: 61,
    bufferZoneWaterM: 5,
    conditions: "2 applications par culture pour contrôler l'ensemble des maladies.",
  }),
  use({
    productId: 506,
    cropCode: "RAPE",
    target: "Sclérotiniose",
    maxDose: 1,
    maxApplications: 2,
    bbchMin: 14,
    bbchMax: 69,
    bufferZoneWaterM: 5,
    conditions: "Uniquement sur colza et lin d'hiver 2 applications non consécutives par an",
  }),
  use({
    productId: 507,
    cropCode: "MAIZ",
    target: "Pucerons",
    maxDose: 1.25,
    maxApplications: 2,
    preHarvestIntervalDays: 80,
    bufferZoneWaterM: 5,
  }),
];

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
        { productId: 501, productName: "ELUMIS", dose: 1.25, doseUnit: "L/ha", target: "Weeds" },
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
    farm: { id: 2, name: "SAT Los Olmos", lat: 41.6, lon: -4.92, countryCode: "ES" },
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
    // The E-Phy catalogue is global: farm 2 sees the same products as farm 1.
    products: farm1.products,
    productUses: farm1.productUses,
    // Its own business tables; market prices are global (the same as farm 1's).
    sales: [
      sale(101, "2024-10-20", "MAIZ", 2024, 35, 205, "COOPERATIVE"),
      sale(102, "2024-07-30", "COWT", 2024, 12.5, 230, "SPOT"),
    ],
    marketPrices: farm1.marketPrices,
    subsidies: [
      { id: 101, year: 2026, scheme: "BISS", amountEur: 8000 },
      { id: 102, year: 2026, scheme: "COUPLED", amountEur: 1500.5 },
    ],
    farmEconomics: [economics(2026, 71766.01, 51118.92, 43264.04)],
    // Region ES418 (Valladolid).
    regionalBenchmarks: [benchmark("LMAIZ", "Maize", 2020, 11.2, 180)],
    // Its own journal: N 90 kg/ha and one spray with a synthetic product (no product_id and
    // not in the catalogue, like the DB's farms outside France).
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
          productName: "Herbicide AS-HER-07 (synthetic)",
          dose: 1,
          doseUnit: "L/ha",
          target: "Malas hierbas",
        }],
      },
    ],
  };
}
