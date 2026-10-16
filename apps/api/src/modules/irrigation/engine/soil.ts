// Soil water holding capacity: FAO-56 Table 19 by USDA texture class, or Saxton & Rawls
// (2006) from texture, and TAW.

export interface SoilTexture {
  sandPct: number;
  clayPct: number;
  organicMatterPct: number;
}

export interface SoilWater {
  /** Volumetric water content at field capacity (33 kPa), m3/m3. */
  thetaFC: number;
  /** Volumetric water content at wilting point (1500 kPa), m3/m3. */
  thetaWP: number;
}

/** Documented fallback when a field has no soil analysis: a typical loam. */
export const DEFAULT_LOAM: SoilWater = { thetaFC: 0.25, thetaWP: 0.12 };

const MAX_OM_PCT = 8;

export function soilWaterFromTexture(t: SoilTexture): SoilWater {
  const S = t.sandPct / 100;
  const C = t.clayPct / 100;
  const OM = Math.min(Math.max(t.organicMatterPct, 0), MAX_OM_PCT);

  const wp1500t = -0.024 * S + 0.487 * C + 0.006 * OM + 0.005 * S * OM - 0.013 * C * OM +
    0.068 * S * C + 0.031;
  const thetaWP = wp1500t + (0.14 * wp1500t - 0.02);

  const fc33t = -0.251 * S + 0.195 * C + 0.011 * OM + 0.006 * S * OM - 0.027 * C * OM +
    0.452 * S * C + 0.299;
  const thetaFC = fc33t + (1.283 * fc33t * fc33t - 0.374 * fc33t - 0.015);

  return { thetaFC, thetaWP };
}

/** Total available water in the root zone, mm. */
export function totalAvailableWater(thetaFC: number, thetaWP: number, rootDepthM: number): number {
  return 1000 * (thetaFC - thetaWP) * rootDepthM;
}

export type UsdaTexture =
  | "Sand"
  | "Loamy sand"
  | "Sandy loam"
  | "Loam"
  | "Silt loam"
  | "Silt"
  | "Sandy clay loam"
  | "Clay loam"
  | "Silty clay loam"
  | "Sandy clay"
  | "Silty clay"
  | "Clay";

/**
 * USDA texture triangle from sand and clay %; silt is the rest. The 12 rules do not
 * overlap and cover the whole triangle, so the order only matters for bad input.
 */
export function usdaTextureClass(sandPct: number, clayPct: number): UsdaTexture {
  const sand = sandPct;
  const clay = clayPct;
  const silt = 100 - sand - clay;

  if (silt + 1.5 * clay < 15) return "Sand";
  if (silt + 1.5 * clay >= 15 && silt + 2 * clay < 30) return "Loamy sand";
  if (
    (clay >= 7 && clay < 20 && sand > 52 && silt + 2 * clay >= 30) ||
    (clay < 7 && silt < 50 && silt + 2 * clay >= 30)
  ) return "Sandy loam";
  if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return "Loam";
  if ((silt >= 50 && clay >= 12 && clay < 27) || (silt >= 50 && silt < 80 && clay < 12)) {
    return "Silt loam";
  }
  if (silt >= 80 && clay < 12) return "Silt";
  if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return "Sandy clay loam";
  if (clay >= 27 && clay < 40 && sand > 20 && sand <= 45) return "Clay loam";
  if (clay >= 27 && clay < 40 && sand <= 20) return "Silty clay loam";
  if (clay >= 35 && sand > 45) return "Sandy clay";
  if (clay >= 40 && silt >= 40) return "Silty clay";
  return "Clay"; // clay >= 40, sand <= 45, silt < 40
}

/** One row of fao56_soil_water (FAO-56 Table 19), mid values. */
export interface SoilWaterClass {
  textureClass: string;
  thetaFcMid: number;
  thetaWpMid: number;
}

/** Lower case, single spaces, and the CSV spelling "Silt clay loam" read as USDA "Silty clay loam". */
function textureKey(name: string): string {
  const key = name.trim().toLowerCase().replace(/\s+/g, " ");
  return key === "silt clay loam" ? "silty clay loam" : key;
}

/** θFC and θWP of a texture class from Table 19; null when the class has no row. */
export function soilWaterFromClass(classes: SoilWaterClass[], texture: string): SoilWater | null {
  const key = textureKey(texture);
  const row = classes.find((c) => textureKey(c.textureClass) === key);
  return row ? { thetaFC: row.thetaFcMid, thetaWP: row.thetaWpMid } : null;
}
