// When to water and how full to refill, by crop stage (FAO-33 Ky). Pure.
import type { CropDay } from "./cropModel";

/** FAO-33 growth periods, each with its own Ky. */
export type KyStage = "vegetative" | "flowering" | "yield_formation" | "ripening";

/** FAO-33 yield response factors of one crop (fao33_ky). Null = no FAO value. */
export interface CropKy {
  vegetative: number | null;
  flowering: number | null;
  yieldFormation: number | null;
  ripening: number | null;
}

/**
 * How the engine waters on a day. FAO-56 allows any net dose up to the depletion (I ≤ Dr) and
 * MAD > RAW "where plant moisture stress is an intentional part of soil water management".
 */
export interface WaterTarget {
  stage: KyStage;
  ky: number | null;
  /** Share of TAW to refill to (0.8 = 80 % full). 1 = field capacity. */
  refillShare: number;
  /** Lowest Ks allowed before watering: 1 = trigger at RAW, 0.8 = 20 % less transpiration. */
  ksMin: number;
}

/** Before flowering the crop may lose this much transpiration (Ks) before we water. */
const KS_MIN_BEFORE_FLOWERING = 0.8;

/**
 * FAO-33 period of a crop day: the sensitive window is flowering; before it, vegetative
 * (even in mid-season); after flowering, yield formation; late and mature are ripening.
 * Without a flowering anchor, mid-season counts as yield formation.
 */
export function kyStageOf(day: CropDay, flowered: boolean, hasFlowering: boolean): KyStage {
  if (day.phase === "late" || day.phase === "mature") return "ripening";
  if (day.sensitive) return "flowering";
  if (flowered) return "yield_formation";
  if (!hasFlowering && day.phase === "mid") return "yield_formation";
  return "vegetative";
}

/**
 * Refill to 80 % of TAW where Ky ≥ 1, 75 % where Ky ≥ 0.5 or unknown, 70 % below.
 * The trigger is RAW, relaxed to Ks 0.8 before flowering (vegetative Ky is low).
 */
export function waterTarget(stage: KyStage, ky: CropKy | null): WaterTarget {
  const k = ky === null ? null : stage === "vegetative"
    ? ky.vegetative
    : stage === "flowering"
    ? ky.flowering
    : stage === "yield_formation"
    ? ky.yieldFormation
    : ky.ripening;
  const refillShare = k === null ? 0.75 : k >= 1 ? 0.8 : k >= 0.5 ? 0.75 : 0.7;
  const ksMin = stage === "vegetative" ? KS_MIN_BEFORE_FLOWERING : 1;
  return { stage, ky: k, refillShare, ksMin };
}

/** Depletion at which Ks reaches `ksMin`: RAW + (1 − ksMin) × (TAW − RAW), FAO-56 eq. 84. */
export function triggerDepletion(taw: number, raw: number, ksMin: number): number {
  return raw + (1 - ksMin) * (taw - raw);
}
