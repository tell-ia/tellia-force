import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FarmSummarySchema, FarmTodaySchema, ParcelReportSchema } from "@tellia/shared";
import farms from "./farms.json";
import oakfieldToday from "./oakfield/advice.json";
import ridgewayToday from "./ridgeway/advice.json";
import valleyReport from "./oakfield/parcel-report.valley.json";
import northSlopeReport from "./ridgeway/parcel-report.northslope.json";

// A schema change that breaks a fixture fails here (and in CI), so the mocked
// client never drifts from the contract the live API must honour.
describe("fixtures match their shared schemas", () => {
  it("farms.json → FarmSummary[]", () => {
    expect(() => z.array(FarmSummarySchema).parse(farms)).not.toThrow();
  });

  it("oakfield/advice.json → FarmToday", () => {
    expect(() => FarmTodaySchema.parse(oakfieldToday)).not.toThrow();
  });

  it("ridgeway/advice.json → FarmToday", () => {
    expect(() => FarmTodaySchema.parse(ridgewayToday)).not.toThrow();
  });

  it("oakfield/parcel-report.valley.json → ParcelReport", () => {
    expect(() => ParcelReportSchema.parse(valleyReport)).not.toThrow();
  });

  it("ridgeway/parcel-report.northslope.json → ParcelReport", () => {
    expect(() => ParcelReportSchema.parse(northSlopeReport)).not.toThrow();
  });
});

describe("the hero parcel is internally consistent", () => {
  const r = ParcelReportSchema.parse(valleyReport);

  it("recommendation respects the 35 mm engine cap", () => {
    expect(r.recommendation.netMm).toBeLessThanOrEqual(35);
  });

  it("today's reserve matches the last non-forecast series point", () => {
    const today = r.series.filter((p) => !p.forecast).at(-1);
    expect(today?.date).toBe(r.asOf);
    expect(Math.round(today!.reserveMm)).toBe(r.reserve.availableMm);
  });

  it("watering lifts every next-day reserve above the no-water case", () => {
    for (const d of r.nextDays) expect(d.pctWatered).toBeGreaterThan(d.pctNoWater);
  });
});
