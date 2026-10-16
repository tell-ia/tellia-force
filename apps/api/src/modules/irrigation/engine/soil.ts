// Soil water holding capacity from texture (Saxton & Rawls 2006) and TAW.

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
