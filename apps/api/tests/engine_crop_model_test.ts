import { assertAlmostEquals, assertEquals } from "@std/assert";
import { adjustP, cropDay, dailyGdd, dailyP } from "../src/modules/irrigation/engine/cropModel";
import { MAIZE_EARLY_PHASES, MAIZE_PARAMS } from "./fixtures/fao";

// ---- degree-days: (min(Tmax, cap) + Tmin) / 2 − base, never negative ----

Deno.test("gdd: Tmax capped at 30 °C for maize", () => {
  assertAlmostEquals(dailyGdd({ tmin: 15, tmax: 34 }, 6, 30), 16.5, 1e-9);
});

Deno.test("gdd: no cap when the crop has none", () => {
  assertAlmostEquals(dailyGdd({ tmin: 15, tmax: 34 }, 6, null), 18.5, 1e-9);
});

Deno.test("gdd: cold day counts 0, never negative", () => {
  assertEquals(dailyGdd({ tmin: 2, tmax: 8 }, 6, 30), 0);
});

Deno.test("gdd: wheat base 0", () => {
  assertAlmostEquals(dailyGdd({ tmin: -2, tmax: 10 }, 0, 30), 4, 1e-9);
});

// ---- phase, Kc (FAO 4 segments on the degree-day axis), root depth ----

Deno.test("crop day: ini phase, Kc ini, roots start growing", () => {
  const d = cropDay(MAIZE_PARAMS, MAIZE_EARLY_PHASES, 100);
  assertEquals(d.phase, "ini");
  assertAlmostEquals(d.kc, 0.3, 1e-9);
  assertAlmostEquals(d.rootDepthM, 0.2 + (100 / 760) * 1.0, 1e-9);
  assertEquals(d.sensitive, false);
});

Deno.test("crop day: dev phase, Kc rises linearly from ini to mid", () => {
  const d = cropDay(MAIZE_PARAMS, MAIZE_EARLY_PHASES, 540);
  assertEquals(d.phase, "dev");
  assertAlmostEquals(d.kc, 0.3 + ((540 - 320) / (760 - 320)) * 0.9, 1e-9);
  assertAlmostEquals(d.rootDepthM, 0.2 + (540 / 760) * 1.0, 1e-9);
});

Deno.test("crop day: mid phase, Kc mid, full roots, flowering window is sensitive", () => {
  const d = cropDay(MAIZE_PARAMS, MAIZE_EARLY_PHASES, 900);
  assertEquals(d.phase, "mid");
  assertAlmostEquals(d.kc, 1.2, 1e-9);
  assertAlmostEquals(d.rootDepthM, 1.2, 1e-9);
  assertEquals(d.sensitive, true);
  assertEquals(d.pCap, 0.45);
});

Deno.test("crop day: late phase, Kc falls linearly to Kc end", () => {
  const d = cropDay(MAIZE_PARAMS, MAIZE_EARLY_PHASES, 1535);
  assertEquals(d.phase, "late");
  assertAlmostEquals(d.kc, 1.2 + ((1535 - 1440) / (1630 - 1440)) * (0.6 - 1.2), 1e-9);
  assertEquals(d.sensitive, false);
  assertEquals(d.pCap, null);
});

Deno.test("crop day: mature after the end of late, Kc end", () => {
  const d = cropDay(MAIZE_PARAMS, MAIZE_EARLY_PHASES, 1700);
  assertEquals(d.phase, "mature");
  assertAlmostEquals(d.kc, 0.6, 1e-9);
});

Deno.test("crop day: phase boundaries are inclusive at the end of each phase", () => {
  assertEquals(cropDay(MAIZE_PARAMS, MAIZE_EARLY_PHASES, 320).phase, "ini");
  assertEquals(cropDay(MAIZE_PARAMS, MAIZE_EARLY_PHASES, 760).phase, "dev");
  assertEquals(cropDay(MAIZE_PARAMS, MAIZE_EARLY_PHASES, 1440).phase, "mid");
  assertEquals(cropDay(MAIZE_PARAMS, MAIZE_EARLY_PHASES, 1630).phase, "late");
});

// ---- p: FAO-56 eq. 5, then the sensitive-window cap ----

Deno.test("p: eq. 5 lowers p on hot days and raises it on cool days", () => {
  assertAlmostEquals(adjustP(0.55, 7), 0.47, 1e-9);
  assertAlmostEquals(adjustP(0.55, 1), 0.71, 1e-9);
});

Deno.test("p: clamped to [0.1, 0.8]", () => {
  assertEquals(adjustP(0.75, 0), 0.8);
  assertEquals(adjustP(0.1, 10), 0.1);
});

Deno.test("p: the flowering cap applies after eq. 5", () => {
  const flowering = cropDay(MAIZE_PARAMS, MAIZE_EARLY_PHASES, 900);
  assertAlmostEquals(dailyP(flowering, 7), 0.45, 1e-9); // eq. 5 gives 0.47, cap 0.45
  assertAlmostEquals(dailyP(flowering, 2), 0.45, 1e-9); // eq. 5 gives 0.67, cap 0.45
  const before = cropDay(MAIZE_PARAMS, MAIZE_EARLY_PHASES, 600);
  assertAlmostEquals(dailyP(before, 7), 0.47, 1e-9);
});
