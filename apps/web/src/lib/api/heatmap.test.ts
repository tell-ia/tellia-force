import { describe, expect, it } from "vitest";
import type { DayBalance } from "@tellia/shared";
import { mergeHeatDays, stitchReports, type HeatDay } from "./heatmap";

const day = (date: string, depletion: number, extra: Partial<DayBalance> = {}): DayBalance =>
  ({ date, taw: 100, depletion, rain: 0, irrigation: 0, ...extra }) as DayBalance;

describe("soil-water heatmap", () => {
  it("keys days by full date, so two years never mix around New Year", () => {
    const byDate = stitchReports([
      { asOf: "2025-12-31", series: [day("2024-12-31", 10), day("2025-12-31", 60)] },
      { asOf: "2026-01-05", series: [day("2026-01-01", 20, { rain: 4.6 })] },
    ]);
    expect(Object.keys(byDate).sort()).toEqual(["2024-12-31", "2025-12-31", "2026-01-01"]);
    expect(byDate["2024-12-31"]!.pct).toBe(90);
    expect(byDate["2025-12-31"]!.pct).toBe(40);
    expect(byDate["2026-01-01"]).toMatchObject({ pct: 80, rain: 5, forecast: false });
  });

  it("an actual reading beats a forecast one, in either order", () => {
    const forecastFirst = stitchReports([
      { asOf: "2026-07-10", series: [day("2026-07-12", 70)] }, // forecast
      { asOf: "2026-07-15", series: [day("2026-07-12", 30)] }, // actual
    ]);
    expect(forecastFirst["2026-07-12"]).toMatchObject({ pct: 70, forecast: false });
    const actualFirst = stitchReports([
      { asOf: "2026-07-15", series: [day("2026-07-12", 30)] },
      { asOf: "2026-07-10", series: [day("2026-07-12", 70)] },
    ]);
    expect(actualFirst["2026-07-12"]).toMatchObject({ pct: 70, forecast: false });
  });

  it("skips failed reports and days without a soil reserve", () => {
    expect(stitchReports([null, { asOf: "2026-07-15", series: [day("2026-07-15", 0, { taw: 0 })] }])).toEqual({});
  });

  it("merges later loads without losing earlier months", () => {
    const july: Record<string, HeatDay> = { "2026-07-01": { pct: 50, rain: 0, irr: 0, forecast: false, reserveMm: 50, capMm: 100 } };
    const may: Record<string, HeatDay> = { "2026-05-01": { pct: 90, rain: 0, irr: 0, forecast: false, reserveMm: 90, capMm: 100 } };
    expect(Object.keys(mergeHeatDays(july, may)).sort()).toEqual(["2026-05-01", "2026-07-01"]);
  });
});
