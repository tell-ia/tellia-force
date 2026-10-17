import { describe, expect, it } from "vitest";
import type { FieldReport } from "@tellia/shared";
import {
  eveLabel,
  fieldReportToReserve,
  grossFromNet,
  rainPct,
  refillPassesNote,
  refillPlan,
  reservePct,
  wateredPct,
} from "./parcel";

describe("parcel mappers (demo numbers)", () => {
  it("gross from 35 mm net at the reel gun ≈ 44 mm", () => {
    expect(grossFromNet(35)).toBe(44);
  });

  it("97 of 144 mm reads 67%", () => {
    expect(reservePct(97, 144)).toBe(67);
  });

  it("the comfort threshold is reached Friday evening", () => {
    // 13 July 2022 is a Wednesday; +2 days → Friday.
    expect(eveLabel("2022-07-13", 2)).toBe("Fri eve");
    expect(eveLabel("2022-07-13", null)).toBe("this week");
  });

  it("Thursday's 61% becomes 85% with 35 mm net", () => {
    expect(wateredPct(61, 35, 144)).toBe(85);
  });

  it("splits the reserve into soil + the day's rain", () => {
    expect(rainPct(8, 120, 60)).toBe(7); // 53% soil + 7% rain
    expect(rainPct(0, 144, 61)).toBe(0);
    expect(rainPct(50, 100, 30)).toBe(30); // rain that drained can't exceed the reserve
  });

  it("maps a FieldReport to the reserve gauge props", () => {
    const report: FieldReport = {
      fieldId: 101,
      fieldName: "The Valley",
      irrigable: true,
      cropCode: "MAIZ",
      cropName: "Grain maize",
      asOf: "2022-07-13",
      stageLabel: "Flowering",
      kc: 1.2,
      decision: "irrigate_today",
      irrigateMm: 35,
      irrigateGrossMm: 47,
      irrigateBy: "2022-07-13",
      headline: "The Valley: irrigate 47 mm today.",
      depletionMm: 47,
      tawMm: 144,
      rawMm: 65,
      depletionPct: 33,
      daysUntilIrrigation: 2,
      rainNext3DaysMm: 0,
      reason: "Flowering, hot and dry.",
      warnings: [],
    };
    expect(fieldReportToReserve(report)).toEqual({
      availableMm: 97,
      capacityMm: 144,
      pct: 67,
      thresholdMm: 79,
      thresholdPct: 55,
      thresholdLabel: "Fri eve",
      usedByThresholdMm: 18,
    });
    // Before flowering the engine waters later: the gauge shows its trigger, not RAW.
    expect(fieldReportToReserve({ ...report, triggerMm: 81 }).thresholdMm).toBe(63);
  });

  it("counts extra passes up to the refill target, not to field capacity", () => {
    // 47 mm depleted but only 20 mm to reach the target: one 30 mm pass is enough.
    expect(refillPlan(47, 30)).not.toBeNull();
    expect(refillPassesNote({ depletionMm: 47, toTargetMm: 20, irrigateMm: 30 })).toBeNull();
    expect(refillPassesNote({ depletionMm: 47, irrigateMm: 30 })).not.toBeNull();
  });
});
