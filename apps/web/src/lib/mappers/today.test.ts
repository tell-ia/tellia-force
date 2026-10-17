import { describe, expect, it } from "vitest";
import type { FarmSummary, FieldReport } from "@tellia/shared";
import { toFarmToday } from "./today";

const report = (over: Partial<FieldReport>): FieldReport => ({
  fieldId: 1,
  fieldName: "Le Moulin",
  irrigable: true,
  cropCode: "COWT",
  cropName: "Winter wheat",
  asOf: "2026-06-01",
  stageLabel: null,
  kc: 1.1,
  decision: "not_irrigable",
  irrigateMm: 0,
  depletionMm: 120,
  tawMm: 195,
  rawMm: 107,
  depletionPct: 62,
  daysUntilIrrigation: null,
  rainNext3DaysMm: 0,
  reason: "Winter wheat is grown rain-fed: no irrigation advice.",
  warnings: [],
  irrigateGrossMm: 0,
  irrigateBy: null,
  headline: "Le Moulin: rain-fed crop, no irrigation.",
  ...over,
});

const farm = { id: 1, farmerName: "Claire" } as FarmSummary;

describe("toFarmToday", () => {
  it("shows a rain-fed crop on an equipped field as Rain-fed, not as needing water", () => {
    const today = toFarmToday({ asOf: "2026-06-01", reports: [report({})] }, farm, []);
    expect(today.parcels[0]).toMatchObject({ status: "idle", badgeLabel: "Rain-fed", grossMm: null });
    expect(today.greeting).toContain("Nothing urgent today.");
  });
});
