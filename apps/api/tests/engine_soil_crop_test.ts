import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  DEFAULT_LOAM,
  soilWaterFromTexture,
  totalAvailableWater,
} from "../src/modules/irrigation/engine/soil";
import {
  cropWaterParams,
  kcAtFraction,
  kcFromRef,
  seasonFraction,
} from "../src/modules/irrigation/engine/crop";

const MAIZ_STAGES = [
  [0, 0.3, 0, "Sowing"],
  [0.05, 0.3, 9, "Emergence"],
  [0.22, 0.37, 30, "Leaf development"],
  [0.3, 0.66, 35, "Stem elongation"],
  [0.47, 1.2, 55, "Tasselling"],
  [0.52, 1.2, 65, "Flowering"],
  [0.6, 1.2, 75, "Grain filling"],
  [0.7, 1.2, 83, "Grain filling 2"],
  [0.85, 0.86, 85, "Dough"],
  [0.93, 0.59, 89, "Maturity"],
  [1, 0.35, 99, "Harvest"],
].map(([seasonFraction, kc, bbch, label]) => ({
  seasonFraction: seasonFraction as number,
  kc: kc as number,
  bbch: bbch as number,
  label: label as string,
}));

Deno.test("Saxton-Rawls field 10 and 11", () => {
  const a = soilWaterFromTexture({ sandPct: 63.5, clayPct: 6.7, organicMatterPct: 5.11 });
  assertAlmostEquals(a.thetaFC, 0.2071, 0.0005);
  assertAlmostEquals(a.thetaWP, 0.0868, 0.0005);
  assertAlmostEquals(totalAvailableWater(a.thetaFC, a.thetaWP, 1.2), 144.3, 0.5);
  const b = soilWaterFromTexture({ sandPct: 30.6, clayPct: 28.3, organicMatterPct: 0.95 });
  assertAlmostEquals(b.thetaFC, 0.3188, 0.0005);
  assertAlmostEquals(b.thetaWP, 0.175, 0.0005);
  assertAlmostEquals(totalAvailableWater(b.thetaFC, b.thetaWP, 1.5), 215.8, 0.5);
});

Deno.test("OM clamped to 8%", () => {
  const t = { sandPct: 40, clayPct: 20 };
  assertEquals(
    soilWaterFromTexture({ ...t, organicMatterPct: 12 }),
    soilWaterFromTexture({ ...t, organicMatterPct: 8 }),
  );
  assertEquals(DEFAULT_LOAM, { thetaFC: 0.25, thetaWP: 0.12 });
});

Deno.test("kcAtFraction MAIZ", () => {
  const m = kcAtFraction(MAIZ_STAGES, 0.5)!;
  assertAlmostEquals(m.kc, 1.2, 1e-9);
  assertEquals(m.stageLabel, "Tasselling");
  assertAlmostEquals(kcAtFraction(MAIZ_STAGES, 0.26)!.kc, 0.515, 1e-9);
  assertAlmostEquals(kcAtFraction(MAIZ_STAGES, 0.89)!.kc, 0.725, 1e-9);
  assertAlmostEquals(kcAtFraction(MAIZ_STAGES, 0)!.kc, 0.3, 1e-9);
  assertAlmostEquals(kcAtFraction(MAIZ_STAGES, 1)!.kc, 0.35, 1e-9);
  assertEquals(kcAtFraction(MAIZ_STAGES, -0.1), null);
  assertEquals(kcAtFraction(MAIZ_STAGES, 1.1), null);
  assertEquals(kcAtFraction([], 0.5), null);
});

Deno.test("kcFromRef", () => {
  const ref = { kcIni: 0.3, kcMid: 1.2, kcEnd: 0.35 };
  assertAlmostEquals(kcFromRef(ref, 0.1)!, 0.3, 1e-9);
  assertAlmostEquals(kcFromRef(ref, 0.275)!, 0.75, 1e-9);
  assertAlmostEquals(kcFromRef(ref, 0.6)!, 1.2, 1e-9);
  assertAlmostEquals(kcFromRef(ref, 0.9)!, 0.775, 1e-9);
  assertEquals(kcFromRef(ref, 1.2), null);
});

Deno.test("seasonFraction", () => {
  assertEquals(seasonFraction(500, 1000), 0.5);
  assertEquals(seasonFraction(1200, 1000), 1);
  assertEquals(seasonFraction(10, 0), null);
  assertEquals(seasonFraction(-5, 100), 0);
});

Deno.test("cropWaterParams", () => {
  assertEquals(cropWaterParams("MAIZ"), { rootDepthM: 1.2, p: 0.55 });
  assertEquals(cropWaterParams("COWT"), { rootDepthM: 1.5, p: 0.55 });
  assertEquals(cropWaterParams("SUNF"), { rootDepthM: 1.0, p: 0.45 });
  assertEquals(cropWaterParams("XXXX"), { rootDepthM: 1.0, p: 0.5 });
  assert(cropWaterParams("RAPE").p === 0.6);
});
