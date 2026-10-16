// Crop growth on the degree-day axis: phase, Kc, root depth and p (FAO-56). Pure.

export type Phase = "ini" | "dev" | "mid" | "late" | "mature";

/** Per-crop FAO-56 values (fao56_crop_stages, fao56_kc, fao56_root_depletion). */
export interface CropParams {
  /** Base temperature for degree-days, °C. */
  tBaseC: number;
  /** Tmax is capped at this value for degree-days; null = no cap. */
  tMaxCapC: number | null;
  kcIni: number;
  kcMid: number;
  kcEnd: number;
  /** Root depth at sowing, m. */
  zrIniM: number;
  /** Root depth at full cover, m. */
  zrMaxM: number;
  /** Depletion fraction from FAO-56 Table 22 (before eq. 5). */
  pTable: number;
}

/** Phase ends in degree-days from sowing (crop_phase_gdd). Each end is inclusive. */
export interface CropPhases {
  iniEnd: number;
  devEnd: number;
  midEnd: number;
  lateEnd: number;
  flowering: number | null;
  /** Window where the crop is sensitive to stress, with its p cap. */
  sensitive: { from: number; to: number; p: number } | null;
}

export interface CropDay {
  phase: Phase;
  kc: number;
  rootDepthM: number;
  pTable: number;
  /** p cap in the sensitive window, else null. */
  pCap: number | null;
  sensitive: boolean;
}

/** Degree-days of one day: max(0, (min(Tmax, cap) + Tmin) / 2 − base). */
export function dailyGdd(
  day: { tmin: number; tmax: number },
  baseC: number,
  tmaxCapC: number | null,
): number {
  const tmax = tmaxCapC === null ? day.tmax : Math.min(day.tmax, tmaxCapC);
  return Math.max(0, (tmax + day.tmin) / 2 - baseC);
}

function phaseAt(phases: CropPhases, gdd: number): Phase {
  if (gdd <= phases.iniEnd) return "ini";
  if (gdd <= phases.devEnd) return "dev";
  if (gdd <= phases.midEnd) return "mid";
  if (gdd <= phases.lateEnd) return "late";
  return "mature";
}

/** Linear move from `from` to `to` as gdd goes from `start` to `end`. */
function lerp(from: number, to: number, start: number, end: number, gdd: number): number {
  if (end <= start) return to;
  return from + ((gdd - start) / (end - start)) * (to - from);
}

/** FAO 4-segment Kc: ini flat, dev linear, mid flat, late linear, then Kc end. */
function kcAt(params: CropParams, phases: CropPhases, phase: Phase, gdd: number): number {
  switch (phase) {
    case "ini":
      return params.kcIni;
    case "dev":
      return lerp(params.kcIni, params.kcMid, phases.iniEnd, phases.devEnd, gdd);
    case "mid":
      return params.kcMid;
    case "late":
      return lerp(params.kcMid, params.kcEnd, phases.midEnd, phases.lateEnd, gdd);
    case "mature":
      return params.kcEnd;
  }
}

/** Crop state on a day, from the degree-days summed since sowing. */
export function cropDay(params: CropParams, phases: CropPhases, gddSinceSowing: number): CropDay {
  const g = gddSinceSowing;
  const phase = phaseAt(phases, g);

  // Roots grow linearly from Zr ini to Zr max over ini + dev, then stay.
  const grown = phases.devEnd > 0 ? Math.min(1, Math.max(0, g / phases.devEnd)) : 1;
  const rootDepthM = params.zrIniM + grown * (params.zrMaxM - params.zrIniM);

  const win = phases.sensitive;
  const inWindow = win !== null && g >= win.from && g <= win.to;

  return {
    phase,
    kc: kcAt(params, phases, phase, g),
    rootDepthM,
    pTable: params.pTable,
    pCap: inWindow ? win.p : null,
    sensitive: inWindow,
  };
}

/** FAO-56 eq. 5: p = p_table + 0.04 × (5 − ETc), kept in [0.1, 0.8]. */
export function adjustP(pTable: number, etcMm: number): number {
  return Math.min(0.8, Math.max(0.1, pTable + 0.04 * (5 - etcMm)));
}

/** p of the day: eq. 5, then the sensitive-window cap. */
export function dailyP(day: CropDay, etcMm: number): number {
  return Math.min(adjustP(day.pTable, etcMm), day.pCap ?? Infinity);
}
