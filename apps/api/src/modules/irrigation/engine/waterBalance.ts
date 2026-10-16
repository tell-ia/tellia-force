// FAO-56 daily root-zone water balance (depletion method). Pure.
import type { DayBalance } from "@tellia/shared/irrigation";
import { adjustP } from "./cropModel";

export interface WeatherInput {
  date: string;
  et0: number;
  rain: number;
  tmin: number;
  /** Crop coefficient; null outside the growing season. */
  kc: number | null;
  /** TAW of the day, mm (grows with the roots). Unset = the input's TAW. */
  taw?: number;
  /** p from FAO-56 Table 22; set = p of the day by eq. 5. Unset = the input's p. */
  pTable?: number;
  /** p cap in the sensitive window, else null. */
  pCap?: number | null;
}

export interface IrrigationInput {
  date: string;
  /** Gross: the water pumped. */
  mm: number;
}

export interface WaterBalanceInput {
  days: WeatherInput[];
  irrigations: IrrigationInput[];
  /** Total available water, mm, for days without their own. */
  taw: number;
  /** Depletion fraction (stress threshold), for days without a pTable. */
  p: number;
  /** Starting depletion, mm. Defaults to 0 (field capacity). */
  startDepletion?: number;
  /** Share of the pumped water that reaches the roots. Defaults to 1. */
  efficiency?: number;
  /**
   * Dry region: at sowing the whole soil profile is `share` empty, down to the full root depth
   * (`tawMax` = TAW at Zr max). The roots bring that deficit with them as they grow, and water
   * draining below the roots refills it first. Unset = the soil below the roots is full.
   */
  dryStart?: { share: number; tawMax: number };
}

/**
 * One DayBalance per day that has a kc. Rain counts in full; water above field capacity
 * is drainage (depletion floors at 0); runoff is ignored. Depletion stays in mm when the
 * TAW grows. State is carried unrounded.
 */
export function runWaterBalance(input: WaterBalanceInput): DayBalance[] {
  const efficiency = input.efficiency ?? 1;
  const irrByDate = new Map<string, number>();
  for (const i of input.irrigations) {
    irrByDate.set(i.date, (irrByDate.get(i.date) ?? 0) + i.mm);
  }
  const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date));

  const firstTaw = days.find((d) => d.kc !== null)?.taw ?? input.taw;
  const dry = input.dryStart;
  const start = input.startDepletion ?? (dry ? dry.share * firstTaw : 0);
  let prev = Math.min(Math.max(start, 0), firstTaw);
  // Deficit of the soil the roots have not reached yet (0 when it is full).
  let below = dry ? dry.share * Math.max(0, dry.tawMax - firstTaw) : 0;
  let reachedTaw = firstTaw;
  const out: DayBalance[] = [];
  for (const d of days) {
    if (d.kc === null) continue;
    const taw = d.taw ?? input.taw;
    if (dry && below > 0 && taw > reachedTaw) {
      // Roots grew into new soil: its share of the deep deficit joins the root zone.
      const moved = below * Math.min(1, (taw - reachedTaw) / (dry.tawMax - reachedTaw));
      below -= moved;
      prev += moved;
    }
    reachedTaw = Math.max(reachedTaw, taw);
    // FAO-56 eq. 5 on the crop's ETc (before stress), then the sensitive-window cap.
    const base = d.pTable != null ? adjustP(d.pTable, d.kc * d.et0) : input.p;
    const p = Math.min(base, d.pCap ?? Infinity);
    const raw = p * taw;
    const ks = prev > raw ? Math.max(0, (taw - prev) / (taw - raw)) : 1;
    const etc = ks * d.kc * d.et0;
    const irrigation = (irrByDate.get(d.date) ?? 0) * efficiency;
    const balance = prev - d.rain - irrigation + etc;
    const depletion = Math.min(Math.max(balance, 0), taw);
    // Water below the roots refills the deep soil first; only the rest is lost.
    let drainage = Math.max(0, -balance);
    const refill = Math.min(drainage, below);
    below -= refill;
    drainage -= refill;
    out.push({
      date: d.date,
      et0: d.et0,
      kc: d.kc,
      ks,
      etc,
      rain: d.rain,
      irrigation,
      drainage,
      depletion,
      taw,
      p,
      raw,
    });
    prev = depletion;
  }
  return out;
}
