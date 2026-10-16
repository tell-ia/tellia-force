// FAO-56 daily root-zone water balance (depletion method). Pure.
import type { DayBalance } from "@tellia/shared/irrigation";

export interface WeatherInput {
  date: string;
  et0: number;
  rain: number;
  tmin: number;
  /** Crop coefficient; null outside the growing season. */
  kc: number | null;
}

export interface IrrigationInput {
  date: string;
  mm: number;
}

export interface WaterBalanceInput {
  days: WeatherInput[];
  irrigations: IrrigationInput[];
  /** Total available water, mm. */
  taw: number;
  /** Depletion fraction (stress threshold). */
  p: number;
  /** Starting depletion, mm. Defaults to 0 (field capacity). */
  startDepletion?: number;
}

/**
 * One DayBalance per day that has a kc. Excess water drains (depletion floors at 0);
 * runoff is ignored. State is carried unrounded.
 */
export function runWaterBalance(input: WaterBalanceInput): DayBalance[] {
  const { taw, p } = input;
  const raw = p * taw;
  const irrByDate = new Map<string, number>();
  for (const i of input.irrigations) {
    irrByDate.set(i.date, (irrByDate.get(i.date) ?? 0) + i.mm);
  }
  const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date));

  let prev = Math.min(Math.max(input.startDepletion ?? 0, 0), taw);
  const out: DayBalance[] = [];
  for (const d of days) {
    if (d.kc === null) continue;
    const ks = prev > raw ? Math.max(0, (taw - prev) / ((1 - p) * taw)) : 1;
    const etc = ks * d.kc * d.et0;
    const irrigation = irrByDate.get(d.date) ?? 0;
    const depletion = Math.min(Math.max(prev - d.rain - irrigation + etc, 0), taw);
    out.push({
      date: d.date,
      et0: d.et0,
      kc: d.kc,
      ks,
      etc,
      rain: d.rain,
      irrigation,
      depletion,
      taw,
      raw,
    });
    prev = depletion;
  }
  return out;
}
