import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { buildFieldReport, type ReportInput } from "../src/modules/irrigation/engine/report";
import { addDays } from "../src/modules/irrigation/engine/util";
import type { WeatherInput } from "../src/modules/irrigation/engine/waterBalance";
import { REEL_GUN } from "./fixtures/fao";

const AS_OF = "2026-07-08";
const SYSTEM = { efficiency: REEL_GUN.efficiency, doseMaxMm: REEL_GUN.doseMaxMm, roundDays: REEL_GUN.roundDays };

/**
 * Days from asOf − 2 to asOf + 6, ETc 5 mm/day, no rain. TAW 100, p 0.55 → RAW 55.
 * Morning depletion on asOf = start + 10.
 */
function input(start: number, over: Partial<ReportInput> = {}, dayOver: Record<number, Partial<WeatherInput>> = {}): ReportInput {
  const days: WeatherInput[] = Array.from({ length: 9 }, (_, i) => ({
    date: addDays(AS_OF, i - 2),
    et0: 5,
    rain: 0,
    tmin: 12,
    kc: 1,
    ...dayOver[i - 2],
  }));
  return {
    field: { id: 10, name: "La Vallée", irrigable: true },
    season: { cropCode: "MAIZ" },
    cropName: "Maïs grain",
    days,
    irrigations: [],
    taw: 100,
    p: 0.55,
    asOf: AS_OF,
    stageLabel: null,
    maxApplicationMm: 35,
    startDepletion: start,
    ...over,
  };
}

Deno.test("decision: threshold within the round days → plan_irrigation by that date", () => {
  // morning 40, end of asOf+2 = 55 ≥ RAW 55 → stress from asOf + 3
  const r = buildFieldReport(input(30, { system: SYSTEM }));
  assertEquals(r.decision, "plan_irrigation");
  assertEquals(r.irrigateBy, "2026-07-11");
  assertEquals(r.daysUntilIrrigation, 3);
  // need 55 mm net → 73 mm gross → capped at 40 mm gross per pass → 30 mm net
  assertEquals(r.irrigateGrossMm, 40);
  assertEquals(r.irrigateMm, 30);
});

Deno.test("decision: threshold further than the round days → no_irrigation, no date yet", () => {
  // morning 30, end of asOf+4 = 55 → stress from asOf + 5 > 3 round days
  const r = buildFieldReport(input(20, { system: SYSTEM }));
  assertEquals(r.decision, "no_irrigation");
  assertEquals(r.daysUntilIrrigation, 5);
  assertEquals(r.irrigateBy, null);
  assertEquals(r.irrigateGrossMm, 0);
});

Deno.test("decision: no threshold in the next 6 days", () => {
  const r = buildFieldReport(input(0, { system: SYSTEM }));
  assertEquals(r.decision, "no_irrigation");
  assertEquals(r.daysUntilIrrigation, null);
  assertEquals(r.irrigateBy, null);
});

Deno.test("decision: above RAW today → irrigate_today, gross capped per pass", () => {
  // morning 64 ≥ 55; need 64 net → 85 gross → 40 gross (30 net) this pass
  const r = buildFieldReport(input(54, { system: SYSTEM }));
  assertEquals(r.decision, "irrigate_today");
  assertEquals(r.irrigateBy, AS_OF);
  assertEquals(r.irrigateGrossMm, 40);
  assertEquals(r.irrigateMm, 30);
  assertStringIncludes(r.reason, "40 mm");
});

Deno.test("decision: rain coming still beats irrigating", () => {
  const r = buildFieldReport(input(54, { system: SYSTEM }, { 1: { rain: 40 } }));
  assertEquals(r.decision, "wait_for_rain");
  assertEquals(r.irrigateGrossMm, 0);
});

Deno.test("decision: frost today holds the watering", () => {
  const r = buildFieldReport(input(54, { system: SYSTEM }, { 0: { tmin: -2 } }));
  assertEquals(r.decision, "frost_hold");
  assertEquals(r.irrigateGrossMm, 40);
});

Deno.test("decision: late phase → crop_maturing, stop irrigating even when dry", () => {
  const r = buildFieldReport(input(54, { system: SYSTEM, phase: "late" }));
  assertEquals(r.decision, "crop_maturing");
  assertEquals(r.irrigateMm, 0);
  assertEquals(r.irrigateGrossMm, 0);
  assertEquals(r.irrigateBy, null);
  assertStringIncludes(r.headline.toLowerCase(), "matur");
});

Deno.test("decision: mature phase → crop_maturing too", () => {
  assertEquals(buildFieldReport(input(54, { system: SYSTEM, phase: "mature" })).decision, "crop_maturing");
});

Deno.test("decision: not irrigable beats maturing", () => {
  const r = buildFieldReport(input(54, { system: SYSTEM, phase: "late", field: { id: 3, name: "Les Longues Raies", irrigable: false } }));
  assertEquals(r.decision, "not_irrigable");
});

Deno.test("decision without an irrigation system keeps the old behaviour", () => {
  const plan = buildFieldReport(input(30));
  assertEquals(plan.decision, "no_irrigation"); // no round days → no plan_irrigation
  assertEquals(plan.daysUntilIrrigation, 3);
  const today = buildFieldReport(input(54));
  assertEquals(today.decision, "irrigate_today");
  assertEquals(today.irrigateMm, 35); // old 35 mm cap, efficiency 1
  assertEquals(today.irrigateGrossMm, 35);
});

Deno.test("headline: one short sentence for voice and SMS, with the field and the action", () => {
  const plan = buildFieldReport(input(30, { system: SYSTEM }));
  assertStringIncludes(plan.headline, "La Vallée");
  assertStringIncludes(plan.headline, "2026-07-11");
  assertStringIncludes(plan.headline, "40 mm");
  const today = buildFieldReport(input(54, { system: SYSTEM }));
  assertStringIncludes(today.headline, "today");
  assertStringIncludes(today.headline, "40 mm");
  for (const start of [0, 20, 30, 54]) {
    const r = buildFieldReport(input(start, { system: SYSTEM }));
    assert(r.headline.length > 0 && r.headline.length <= 160, r.headline);
  }
});

Deno.test("decision: a rain-fed crop on an equipped field gets no irrigation advice", () => {
  // Morning 64 ≥ RAW 55: a maize field would irrigate today.
  const r = buildFieldReport(input(54, { system: SYSTEM, rainFedCrop: true, cropName: "Blé tendre d'hiver" }));
  assertEquals(r.decision, "not_irrigable");
  assertEquals(r.irrigable, true); // the field keeps its reel gun
  assertEquals(r.irrigateGrossMm, 0);
  assertStringIncludes(r.reason, "Blé tendre d'hiver is grown rain-fed");
  assertStringIncludes(r.headline, "rain-fed");
});
