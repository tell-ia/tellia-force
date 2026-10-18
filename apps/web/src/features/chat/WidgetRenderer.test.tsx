import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import {
  FarmLookupSchema,
  FieldDetailsSchema,
  FieldJournalSchema,
  IrrigationConfirmationSchema,
  IrrigationCorrectionSchema,
  ProductCheckSchema,
  type FarmLookup,
  type FieldDetails,
  type FieldJournal,
  type IrrigationConfirmation,
  type IrrigationCorrection,
  type ProductCheck,
} from "@tellia/shared";
import { WidgetRenderer } from "./WidgetRenderer";

// Server-side render of each new chat card: a sample output (checked against the shared
// contract) and an empty / broken output must render without throwing.

const render = (toolKey: string, output: unknown): string =>
  renderToString(<WidgetRenderer toolKey={toolKey} state="output-available" output={output} onReply={() => {}} />);

const fieldDetails: FieldDetails = {
  field: { id: 101, name: "La Vallee", areaHa: 12.5, tenure: "owned", irrigable: true },
  crop: {
    seasonId: 7,
    code: "MAIZ",
    name: "Grain maize",
    variety: "P9911",
    earlinessGroup: "G4",
    sowingDate: "2026-04-20",
    harvestDate: "2026-10-05",
    status: "growing",
    previousCropName: "Soft wheat",
  },
  irrigationSystem: { name: "Reel gun 1", type: "reel_gun", efficiency: 0.8, doseMinMm: 20, doseMaxMm: 35, roundDays: 7 },
  soil: {
    sampledOn: "2025-11-02",
    textureClass: "Silt loam",
    sandPct: 20,
    siltPct: 62,
    clayPct: 18,
    organicMatterPct: 2.1,
    ph: 6.8,
    nitrogenGKg: 1.25,
    phosphorusMgKg: 48,
    potassiumMgKg: 190,
    sulfurMgKg: null,
    calciumMgKg: 2100,
    magnesiumMgKg: 140,
    zincMgKg: 1.4,
    boronMgKg: 0.42,
    cecCmolKg: 12.5,
    bulkDensityKgDm3: 1.35,
    limeRequirementTHa: null,
  },
};

const journal: FieldJournal = {
  fieldId: 101,
  fieldName: "La Vallee",
  type: null,
  from: "2026-04-20",
  to: "2026-10-05",
  entries: [
    {
      operationId: 9,
      date: "2026-10-20",
      type: "harvest",
      fieldId: 101,
      fieldName: "La Vallee",
      status: "planned",
      planned: true,
      bbch: null,
      products: [],
    },
    {
      operationId: 8,
      date: "2026-06-12",
      type: "spraying",
      fieldId: 101,
      fieldName: "La Vallee",
      status: "confirmed",
      planned: false,
      bbch: 32,
      products: [{ productName: "ELUMIS", dose: 1.25, doseUnit: "L/ha", target: "weeds" }],
    },
    {
      operationId: 7,
      date: "2026-05-02",
      type: "fertilisation",
      fieldId: 101,
      fieldName: "La Vallee",
      status: "confirmed",
      planned: false,
      bbch: 14,
      fertiliserType: "UAN 30",
      nKgHa: 60,
      products: [],
      notes: "Before the rain",
    },
  ],
  totals: { count: 2, byType: { spraying: 1, fertilisation: 1 }, nKgHa: 60, p2o5KgHa: 0, k2oKgHa: 0, irrigationMm: 0, sprays: 1, planned: 1 },
  truncated: true,
};

const productFound: ProductCheck = {
  query: "amistar",
  date: "2026-07-01",
  fieldId: 101,
  fieldName: "La Vallee",
  crop: { seasonId: 7, code: "MAIZ", name: "Grain maize", sowingDate: "2026-04-20", harvestDate: "2026-10-05" },
  status: "found",
  product: { productId: 3, name: "AMISTAR", ammNumber: "2010327", kind: "fungicide", activeSubstances: "azoxystrobin", synthetic: false },
  matches: [],
  authorised: true,
  uses: [
    {
      target: "Leaf diseases",
      maxDose: 1,
      doseUnit: "L/ha",
      maxApplications: 2,
      preHarvestIntervalDays: 35,
      bbchMin: 30,
      bbchMax: 69,
      bufferZoneWaterM: 5,
      conditions: null,
      preHarvestOk: true,
    },
  ],
  usage: { timesUsed: 1, lastDate: "2026-06-12", applications: [{ date: "2026-06-12", dose: 1, doseUnit: "L/ha" }] },
  applicationsLeft: 1,
  daysToHarvest: 96,
  preHarvestOk: true,
  warnings: ["The crop stage (BBCH 30-69) is not checked: check it in the field."],
};

const productAmbiguous: ProductCheck = {
  ...productFound,
  status: "ambiguous",
  product: null,
  matches: [
    { productId: 3, name: "AMISTAR", ammNumber: null, kind: null, activeSubstances: null, synthetic: false },
    { productId: 4, name: "AMISTAR GOLD", ammNumber: null, kind: null, activeSubstances: null, synthetic: false },
  ],
  authorised: null,
  uses: [],
  usage: null,
  applicationsLeft: null,
  preHarvestOk: null,
  warnings: [],
};

const lookups: FarmLookup[] = [
  {
    table: "sale",
    synthetic: true,
    note: "Synthetic demo data.",
    year: 2024,
    cropCode: null,
    count: 12,
    truncated: true,
    rows: [
      { saleDate: "2024-09-15", cropCode: "COWT", cropName: "Soft wheat", harvestYear: 2024, volumeT: 120, priceEurT: 205.5, revenueEur: 24660, buyer: null, contractType: "SPOT", qualityGrade: null },
    ],
    summary: {
      volumeT: 300,
      revenueEur: 61000,
      averagePriceEurT: null,
      byCrop: [
        { cropCode: "COWT", cropName: "Soft wheat", volumeT: 200, revenueEur: 41000, averagePriceEurT: 205 },
        { cropCode: "MAIZ", cropName: "Grain maize", volumeT: 100, revenueEur: 20000, averagePriceEurT: 200 },
      ],
    },
  },
  {
    table: "market_price",
    synthetic: true,
    note: "Reference prices +/- 2.3 %.",
    year: null,
    cropCode: "COWT",
    count: 2,
    truncated: false,
    rows: [
      { cropCode: "COWT", cropName: "Soft wheat", year: 2026, month: 11, priceEurT: 212, forecast: true },
      { cropCode: "COWT", cropName: "Soft wheat", year: 2026, month: 9, priceEurT: 208, forecast: false },
    ],
    summary: null,
  },
  {
    table: "subsidy",
    synthetic: true,
    note: "Synthetic demo data.",
    year: null,
    cropCode: null,
    count: 2,
    truncated: false,
    rows: [
      { year: 2025, scheme: "ECO_SCHEME", amountEur: 4200 },
      { year: 2024, scheme: "BISS", amountEur: 15000 },
    ],
    summary: { totalEur: 19200, byYear: [{ year: 2025, totalEur: 4200 }, { year: 2024, totalEur: 15000 }] },
  },
  {
    table: "farm_economics",
    synthetic: true,
    note: "Accounts are flat over the years.",
    year: 2024,
    cropCode: null,
    count: 1,
    truncated: false,
    rows: [
      {
        year: 2024,
        totalOutputEur: 250000,
        seedsEur: 20000,
        fertiliserEur: 30000,
        cropProtectionEur: 15000,
        energyEur: 12000,
        contractWorkEur: 8000,
        wagesEur: 40000,
        depreciationEur: 30000,
        totalInputsEur: 155000,
        farmNetValueAddedEur: 65000,
      },
    ],
    summary: null,
  },
  {
    table: "regional_benchmark",
    synthetic: false,
    note: "Real regional statistics.",
    year: null,
    cropCode: "MAIZ",
    count: 1,
    truncated: false,
    rows: [
      {
        cropGroupCode: "C1500",
        cropGroupName: "Grain maize",
        year: 2023,
        yieldTHa: 9.8,
        yieldSourceGeography: null,
        yieldValueType: null,
        nKgHa: 170,
        p2o5KgHa: null,
        k2oKgHa: null,
        npkReferenceYear: null,
        irrigatedShare: 0.42,
        pesticideTotalKgAiHa: null,
        herbicideKgAiHa: null,
        fungicideKgAiHa: null,
        insecticideKgAiHa: null,
        pesticideReference: null,
      },
    ],
    summary: null,
  },
];

const correction: IrrigationCorrection = {
  runId: "run-1",
  status: "awaiting_confirmation",
  summary: "Change the irrigation on La Vallee from 30 mm on 2026-10-16 to 25 mm on 2026-10-16?",
  fieldName: "La Vallee",
  action: "update",
  before: { date: "2026-10-16", mm: 30 },
  after: { date: "2026-10-16", mm: 25 },
};

const NEW_KEYS = ["getFieldDetails", "getFieldJournal", "checkProductUse", "lookupFarmData", "correctIrrigation", "confirmIrrigation"];

/** Wrong types everywhere: the cards must still render. */
const broken = {
  field: "x",
  crop: 5,
  irrigationSystem: [],
  soil: "rich",
  entries: "none",
  totals: [1],
  byType: 3,
  product: [],
  usage: "x",
  uses: {},
  matches: [null, 3, "a"],
  warnings: [1, {}, null],
  table: "sale",
  rows: [null, "x", {}],
  summary: "y",
  record: 7,
  before: null,
  after: "z",
  status: {},
  action: 3,
};

describe("chat cards for the new tools", () => {
  it("the samples follow the shared contracts", () => {
    expect(() => FieldDetailsSchema.parse(fieldDetails)).not.toThrow();
    expect(() => FieldJournalSchema.parse(journal)).not.toThrow();
    expect(() => ProductCheckSchema.parse(productFound)).not.toThrow();
    expect(() => ProductCheckSchema.parse(productAmbiguous)).not.toThrow();
    for (const l of lookups) expect(() => FarmLookupSchema.parse(l)).not.toThrow();
    expect(() => IrrigationCorrectionSchema.parse(correction)).not.toThrow();
  });

  it("getFieldDetails shows the field, crop, system and soil", () => {
    const html = render("getFieldDetails", fieldDetails);
    for (const text of ["La Vallee", "12.5 ha", "Grain maize", "Reel gun 1", "20–35 mm", "80 %", "Silt loam", "See the parcel"]) {
      expect(html).toContain(text);
    }
  });

  it("getFieldDetails says when there is no crop", () => {
    expect(render("getFieldDetails", { ...fieldDetails, crop: null })).toContain("No crop on this field today.");
  });

  it("getFieldJournal shows totals, entries and a different look for planned rows", () => {
    const html = render("getFieldJournal", journal);
    for (const text of ["Journal", "N kg/ha", "Fertiliser", "UAN 30", "ELUMIS 1.25 L/ha", "Planned", "dashed", "totals cover the whole period"]) {
      expect(html).toContain(text);
    }
  });

  it("checkProductUse shows the verdict, the uses and the warnings", () => {
    const html = render("checkProductUse", productFound);
    for (const text of ["AMISTAR", "Authorised", "Leaf diseases", "BBCH 30–69", "Uses left", "is not checked"]) {
      expect(html).toContain(text);
    }
    expect(render("checkProductUse", { ...productFound, authorised: false })).toContain("Not authorised");
  });

  it("checkProductUse lists the candidates when ambiguous, and says when nothing matches", () => {
    const html = render("checkProductUse", productAmbiguous);
    expect(html).toContain("Several matches");
    expect(html).toContain("AMISTAR GOLD");
    const none = render("checkProductUse", { ...productAmbiguous, status: "not_found", matches: [] });
    expect(none).toContain("Not found");
  });

  it("lookupFarmData renders every table with its summary and note", () => {
    const [sale, price, subsidy, economics, benchmark] = lookups.map((l) => render("lookupFarmData", l));
    expect(sale).toContain("Sales");
    expect(sale).toContain("Demo data");
    expect(sale).toContain("61,000");
    expect(sale).toContain("Synthetic demo data.");
    expect(sale).toContain("1 of 12 rows shown.");
    expect(price).toContain("forecast");
    expect(subsidy).toContain("19,200");
    expect(subsidy).toContain("ECO SCHEME");
    expect(economics).toContain("65,000");
    expect(benchmark).toContain("Statistics");
    expect(benchmark).toContain("42 %");
  });

  it("correctIrrigation reuses the Yes / No confirmation card", () => {
    const html = render("correctIrrigation", correction);
    for (const text of ["Confirm correction", "25 mm on 2026-10-16", "Yes", "No"]) expect(html).toContain(text);
    const del = render("correctIrrigation", { ...correction, action: "delete", after: null, summary: undefined });
    expect(del).toContain("Confirm deletion");
    expect(del).toContain("delete 2026-10-16 30 mm");
  });

  it("confirmIrrigation shows saved, updated, deleted and cancelled", () => {
    const record = { operationId: 5, fieldId: 101, date: "2026-10-16", mm: 25, status: "confirmed" };
    const cases: [IrrigationConfirmation, string][] = [
      [{ status: "saved", record }, "Saved to the logbook"],
      [{ status: "updated", record }, "Logbook updated"],
      [{ status: "deleted" }, "Removed from the logbook"],
      [{ status: "cancelled" }, "Cancelled"],
    ];
    for (const [output, text] of cases) {
      expect(() => IrrigationConfirmationSchema.parse(output)).not.toThrow();
      expect(render("confirmIrrigation", output)).toContain(text);
    }
  });

  it("an empty, missing or broken output never crashes a new card", () => {
    for (const key of NEW_KEYS) {
      for (const output of [{}, undefined, null, "text", [], broken]) {
        expect(() => render(key, output), `${key} with ${JSON.stringify(output)}`).not.toThrow();
      }
    }
    for (const table of ["sale", "market_price", "subsidy", "farm_economics", "regional_benchmark", "other"]) {
      expect(() => render("lookupFarmData", { ...broken, table })).not.toThrow();
      expect(() => render("lookupFarmData", { table, rows: [{}], summary: {} })).not.toThrow();
    }
  });
});
