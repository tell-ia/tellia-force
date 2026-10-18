import { describe, expect, it } from "vitest";
import type { FieldReport } from "@tellia/shared";
import {
  eveLabel,
  fieldReportToReserve,
  grossFromNet,
  irrigateByLabel,
  rainPct,
  refillPassesNote,
  refillPlan,
  reservePct,
  wateredPct,
  cropLine,
  formDose,
  wateredOnMm,
  heroDose,
} from "./parcel";

describe("crop line", () => {
  it("crop and stage, crop alone, or no crop", () => {
    expect(cropLine("Maïs grain", "Flowering")).toBe("Maïs grain · Flowering");
    expect(cropLine("Maïs grain", null)).toBe("Maïs grain");
    expect(cropLine("—", null)).toBe("No crop growing");
  });
});

describe("Log screen dose", () => {
  it("untouched: the advised dose, so it follows a new advice (35 mm when nothing is advised)", () => {
    expect(formDose(null, 30)).toBe(30);
    expect(formDose(null, 25)).toBe(25); // the report reloaded after a delete: new advice
    expect(formDose(null, 0)).toBe(35);
  });

  it("set with the stepper: the user's dose stays, whatever the advice", () => {
    expect(formDose(40, 30)).toBe(40);
    expect(formDose(40, 25)).toBe(40);
  });
});

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

describe("irrigation date and passes", () => {
  it("names the day to irrigate by", () => {
    expect(irrigateByLabel("2026-07-15", "2026-07-15")).toBe("Irrigate today");
    expect(irrigateByLabel("2026-07-15", "2026-07-16")).toBe("Irrigate tomorrow");
    expect(irrigateByLabel("2026-07-15", "2026-07-17")).toBe("Irrigate by Fri 17 Jul");
    expect(irrigateByLabel("2026-07-15", null)).toBe("Irrigate soon");
  });

  it("counts the passes still needed to the target, ignoring a leftover under half a pass", () => {
    // 39 mm to the target, 30 mm per pass: 9 mm left is not worth announcing a pass.
    expect(refillPassesNote({ depletionMm: 120, toTargetMm: 39, irrigateMm: 30, targetFillPct: 80 })).toBeNull();
    // 92 mm to go: this pass, then ~2 more.
    expect(refillPassesNote({ depletionMm: 121, toTargetMm: 92, irrigateMm: 30, targetFillPct: 75 })).toBe(
      "then ~2 more passes to reach 75 % (92 mm to go)",
    );
    // Old reports (no target): counted to field capacity.
    expect(refillPassesNote({ depletionMm: 75, irrigateMm: 30 })).toBe(
      "then ~2 more passes to refill (75 mm deficit)",
    );
  });
});

describe("watered on a day", () => {
  const rec = (date: string, mm: number, status = "confirmed") => ({ operationId: 1, fieldId: 7, date, mm, status });
  it("sums that day's waterings, ignores other days and drafts", () => {
    const log = [rec("2022-07-13", 40), rec("2022-07-13", 20, "planned"), rec("2022-07-12", 40), rec("2022-07-13", 30, "draft")];
    expect(wateredOnMm(log, "2022-07-13")).toBe(60);
  });
  it("null when nothing was logged that day", () => {
    expect(wateredOnMm([rec("2022-07-12", 40)], "2022-07-13")).toBeNull();
    expect(wateredOnMm([], "2022-07-13")).toBeNull();
  });
});

describe("hero dose with today's watering", () => {
  const rec = (decision: string, grossMm: number, headline = "Irrigate now") =>
    ({ decision, headline, grossMm, netMm: Math.round(grossMm * 0.75), efficiency: 0.75, reason: "", secondPass: null });

  it("nothing logged today: the advice as it is", () => {
    expect(heroDose(rec("irrigate_today", 40), null)).toEqual({ mode: "plain", headline: "Irrigate now", label: "Apply", mm: 40 });
  });
  it("watered today and nothing more needed: what went on", () => {
    expect(heroDose(rec("no_irrigation", 0, "No water needed"), 40)).toEqual({
      mode: "done", headline: "Watered today", label: "Applied today", mm: 40, reachedMm: 30,
    });
  });
  it("watered today and more needed now: a top-up on top of what went on", () => {
    expect(heroDose(rec("irrigate_today", 40), 40)).toEqual({
      mode: "topUp", headline: "Top up now", label: "Apply another", mm: 40, appliedMm: 40, reachedMm: 30,
    });
  });
  it("watered today, next one later: keeps the date headline", () => {
    expect(heroDose(rec("plan_irrigation", 40, "Irrigate by Fri 15"), 20).headline).toBe("Irrigate by Fri 15");
  });
});
