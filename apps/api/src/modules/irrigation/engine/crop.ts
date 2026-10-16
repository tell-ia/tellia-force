// Crop water parameters and crop coefficient (Kc) curves.

/** FAO-56 Table 22 values kept in code because the DB has no such columns. */
const WATER_PARAMS: Record<string, { rootDepthM: number; p: number }> = {
  MAIZ: { rootDepthM: 1.2, p: 0.55 },
  COWT: { rootDepthM: 1.5, p: 0.55 },
  BARL: { rootDepthM: 1.2, p: 0.55 },
  RAPE: { rootDepthM: 1.2, p: 0.6 },
  SUNF: { rootDepthM: 1.0, p: 0.45 },
};
const DEFAULT_WATER_PARAMS = { rootDepthM: 1.0, p: 0.5 };

export function cropWaterParams(cropCode: string): { rootDepthM: number; p: number } {
  return { ...(WATER_PARAMS[cropCode] ?? DEFAULT_WATER_PARAMS) };
}

export interface StagePoint {
  seasonFraction: number;
  kc: number;
  label?: string | null;
  bbch?: number | null;
}

/**
 * Linear interpolation of Kc between stage points. `stageLabel` is that of the
 * last stage reached. Null when fraction is outside [0, 1] or there are no stages.
 */
export function kcAtFraction(
  stages: StagePoint[],
  fraction: number,
): { kc: number; stageLabel: string | null } | null {
  if (fraction < 0 || fraction > 1 || stages.length === 0) return null;
  const sorted = [...stages].sort((a, b) => a.seasonFraction - b.seasonFraction);

  let idx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].seasonFraction <= fraction) idx = i;
  }
  if (idx === -1) idx = 0; // before the first point: hold its value
  const cur = sorted[idx];
  const next = sorted[idx + 1];

  let kc = cur.kc;
  if (next && fraction > cur.seasonFraction) {
    const span = next.seasonFraction - cur.seasonFraction;
    kc = cur.kc + ((fraction - cur.seasonFraction) / span) * (next.kc - cur.kc);
  }
  return { kc, stageLabel: cur.label ?? null };
}

/** FAO four-segment Kc curve, used when a crop has no stage rows. */
export function kcFromRef(
  ref: { kcIni: number; kcMid: number; kcEnd: number },
  fraction: number,
): number | null {
  if (fraction < 0 || fraction > 1) return null;
  if (fraction < 0.15) return ref.kcIni;
  if (fraction < 0.4) return ref.kcIni + ((fraction - 0.15) / 0.25) * (ref.kcMid - ref.kcIni);
  if (fraction < 0.8) return ref.kcMid;
  return ref.kcMid + ((fraction - 0.8) / 0.2) * (ref.kcEnd - ref.kcMid);
}

/** Share of the season's degree-days accumulated, clamped to [0, 1]; null if total <= 0. */
export function seasonFraction(gddSoFar: number, gddTotal: number): number | null {
  if (gddTotal <= 0) return null;
  return Math.min(1, Math.max(0, gddSoFar / gddTotal));
}
