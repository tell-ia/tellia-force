import { assertAlmostEquals, assertEquals, assertStringIncludes } from "@std/assert";
import { buildFieldReport, type ReportInput } from "../src/modules/irrigation/engine/report";
import { addDays } from "../src/modules/irrigation/engine/util";
import type { CropDay } from "../src/modules/irrigation/engine/cropModel";
import { kyStageOf, waterTarget } from "../src/modules/irrigation/engine/waterTarget";
import { REEL_GUN } from "./fixtures/fao";

const AS_OF = "2026-07-08";
const SYSTEM = {
  efficiency: REEL_GUN.efficiency,
  doseMinMm: REEL_GUN.doseMinMm,
  doseMaxMm: REEL_GUN.doseMaxMm,
  roundDays: REEL_GUN.roundDays,
};
/** FAO-33 sunflower (fao33_ky.csv). */
const SUNF_KY = { vegetative: 0.4, flowering: 1.0, yieldFormation: 0.8, ripening: null };

const day = (over: Partial<CropDay>): CropDay => ({
  phase: "dev",
  kc: 1,
  rootDepthM: 1,
  pTable: 0.45,
  pCap: null,
  sensitive: false,
  ...over,
});

/** Days asOf − 2 … asOf + 6, ETc 5 mm/day, no rain. Morning depletion on asOf = start + 10. */
function input(start: number, over: Partial<ReportInput> = {}): ReportInput {
  const days = Array.from({ length: 9 }, (_, i) => ({
    date: addDays(AS_OF, i - 2),
    et0: 5,
    rain: 0,
    tmin: 12,
    kc: 1,
  }));
  return {
    field: { id: 16, name: "La Hoya", irrigable: true },
    season: { cropCode: "SUNF" },
    cropName: "Girasol",
    days,
    irrigations: [],
    taw: 100,
    p: 0.55,
    asOf: AS_OF,
    stageLabel: null,
    startDepletion: start,
    system: SYSTEM,
    ...over,
  };
}

Deno.test("ky stage: before the window is vegetative, in it flowering, after it yield formation", () => {
  assertEquals(kyStageOf(day({ phase: "dev" }), false, true), "vegetative");
  // Mid-season but not flowered yet (sunflower in June): still before flowering.
  assertEquals(kyStageOf(day({ phase: "mid" }), false, true), "vegetative");
  assertEquals(kyStageOf(day({ phase: "mid", sensitive: true }), false, true), "flowering");
  assertEquals(kyStageOf(day({ phase: "mid", sensitive: true }), true, true), "flowering");
  assertEquals(kyStageOf(day({ phase: "mid" }), true, true), "yield_formation");
  assertEquals(kyStageOf(day({ phase: "late" }), true, true), "ripening");
  // No flowering anchor: mid-season counts as after flowering.
  assertEquals(kyStageOf(day({ phase: "mid" }), false, false), "yield_formation");
});

Deno.test("water target: Ky sets the refill share, the trigger is relaxed only before flowering", () => {
  assertEquals(waterTarget("vegetative", SUNF_KY), {
    stage: "vegetative",
    ky: 0.4,
    refillShare: 0.7,
    ksMin: 0.8,
  });
  assertEquals(waterTarget("flowering", SUNF_KY).refillShare, 0.8);
  assertEquals(waterTarget("flowering", SUNF_KY).ksMin, 1);
  assertEquals(waterTarget("yield_formation", SUNF_KY).refillShare, 0.75);
  // No Ky for the stage or the crop: middle target.
  assertEquals(waterTarget("ripening", SUNF_KY).refillShare, 0.75);
  assertEquals(waterTarget("yield_formation", null).refillShare, 0.75);
  assertEquals(waterTarget("vegetative", null).ksMin, 0.8);
});

Deno.test("relaxed trigger before flowering: past RAW but under Ks 0.8 → no water today", () => {
  // RAW 55; relaxed trigger 55 + 0.2 × 45 = 64. Morning 60, end of asOf 65 → stress tomorrow.
  const strict = buildFieldReport(input(50));
  assertEquals(strict.decision, "irrigate_today");
  const r = buildFieldReport(input(50, { target: waterTarget("vegetative", SUNF_KY) }));
  assertEquals(r.decision, "plan_irrigation");
  assertEquals(r.irrigateBy, addDays(AS_OF, 1));
  assertEquals(r.rawMm, 55);
  assertEquals(r.triggerMm, 64);
  assertStringIncludes(r.reason, "before flowering");
});

Deno.test("refill target: water back to 80 % in flowering, not to field capacity", () => {
  // TAW 80, RAW 40. Morning 45 → net 45 − 0.2 × 80 = 29 mm → 39 mm gross (full refill: 60).
  const r = buildFieldReport(input(35, { taw: 80, p: 0.5, target: waterTarget("flowering", SUNF_KY) }));
  assertEquals(r.decision, "irrigate_today");
  assertEquals(r.irrigateMm, 29);
  assertEquals(r.irrigateGrossMm, 39);
  assertEquals(r.targetFillPct, 80);
  assertEquals(r.toTargetMm, 29);
  assertStringIncludes(r.reason, "80 %");
  assertStringIncludes(r.reason, "60 mm");
  assertStringIncludes(r.headline, "39 mm");
});

Deno.test("refill target: a small need still gets the system's minimum pass", () => {
  // TAW 30, RAW 15. Morning 16 → net 16 − 6 = 10 → 13 gross, below the 20 mm minimum.
  const r = buildFieldReport(input(6, { taw: 30, p: 0.5, target: waterTarget("flowering", SUNF_KY) }));
  assertEquals(r.decision, "irrigate_today");
  assertEquals(r.irrigateGrossMm, 20);
  assertEquals(r.irrigateMm, 15);
  assertEquals(r.toTargetMm, 10);
});

Deno.test("refill target: a big need is capped per pass, more passes for the gap to the target", () => {
  // TAW 100, RAW 55, flowering. Morning 64 → net 64 − 20 = 44 → 59 gross → 40 (30 net).
  const r = buildFieldReport(input(54, { target: waterTarget("flowering", SUNF_KY) }));
  assertEquals(r.irrigateGrossMm, 40);
  assertAlmostEquals(r.irrigateMm, 30);
  assertEquals(r.toTargetMm, 44);
  assertStringIncludes(r.reason, "more passes for the 44 mm");
});

Deno.test("rain coming covers the gap to the target → wait", () => {
  // Flowering, morning 64, gap 44: 25 mm of rain tomorrow is more than half of it.
  const r = buildFieldReport({
    ...input(54, { target: waterTarget("flowering", SUNF_KY) }),
    days: input(54).days.map((d) => d.date === addDays(AS_OF, 1) ? { ...d, rain: 25 } : d),
  });
  assertEquals(r.decision, "wait_for_rain");
});

Deno.test("without a target the report keeps refilling to field capacity", () => {
  const r = buildFieldReport(input(35, { taw: 80, p: 0.5 }));
  assertEquals(r.irrigateGrossMm, 40);
  assertEquals(r.targetFillPct, 100);
  assertEquals(r.triggerMm, 40);
});
