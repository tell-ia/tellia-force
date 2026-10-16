import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  soilWaterFromClass,
  totalAvailableWater,
  usdaTextureClass,
} from "../src/modules/irrigation/engine/soil";
import { SOIL_CLASSES } from "./fixtures/fao";

// ---- USDA texture triangle (sand %, clay %; silt = the rest) ----

Deno.test("texture: the demo fields", () => {
  assertEquals(usdaTextureClass(63.5, 6.7), "Sandy loam"); // La Vallée
  assertEquals(usdaTextureClass(30.6, 28.3), "Clay loam"); // Le Puits
});

Deno.test("texture: one point inside each of the 12 classes", () => {
  const cases: [number, number, string][] = [
    [90, 3, "Sand"],
    [80, 5, "Loamy sand"],
    [65, 10, "Sandy loam"],
    [40, 20, "Loam"],
    [20, 15, "Silt loam"],
    [10, 5, "Silt"],
    [60, 25, "Sandy clay loam"],
    [35, 32, "Clay loam"],
    [10, 30, "Silty clay loam"],
    [50, 40, "Sandy clay"],
    [5, 45, "Silty clay"],
    [20, 50, "Clay"],
  ];
  for (const [sand, clay, expected] of cases) {
    assertEquals(usdaTextureClass(sand, clay), expected, `sand ${sand} clay ${clay}`);
  }
});

// ---- FAO-56 Table 19 lookup ----

Deno.test("table 19: sandy loam gives θFC 0.23 and θWP 0.11", () => {
  const sw = soilWaterFromClass(SOIL_CLASSES, "Sandy loam")!;
  assertAlmostEquals(sw.thetaFC, 0.23, 1e-9);
  assertAlmostEquals(sw.thetaWP, 0.11, 1e-9);
});

Deno.test("table 19: La Vallée holds 144 mm with 1.2 m of roots (Marceau's mockup)", () => {
  const sw = soilWaterFromClass(SOIL_CLASSES, usdaTextureClass(63.5, 6.7))!;
  assertAlmostEquals(totalAvailableWater(sw.thetaFC, sw.thetaWP, 1.2), 144, 1e-9);
});

Deno.test("table 19: 'Silty clay loam' matches the CSV spelling 'Silt clay loam'", () => {
  const sw = soilWaterFromClass(SOIL_CLASSES, "Silty clay loam")!;
  assertAlmostEquals(sw.thetaFC, 0.335, 1e-9);
});

Deno.test("table 19: unknown class gives null (caller falls back to Saxton-Rawls)", () => {
  assertEquals(soilWaterFromClass([], "Loam"), null);
});
