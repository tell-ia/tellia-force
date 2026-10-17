// Pure month/year helpers for the date picker. Dates are ISO "YYYY-MM-DD"; months are 0-11.

export const pad2 = (n: number): string => String(n).padStart(2, "0");

/** "2026-07-05" for (2026, 6, 5). */
export const isoOf = (year: number, month: number, day: number): string => `${year}-${pad2(month + 1)}-${pad2(day)}`;

export const daysIn = (year: number, month: number): number => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

export const endOfMonth = (year: number, month: number): string => isoOf(year, month, daysIn(year, month));

/** Empty cells before the 1st in a Monday-first week (0 = the 1st is a Monday). */
export const mondayOffset = (year: number, month: number): number => (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;

export const clampDate = (d: string, min: string, max: string): string => (d < min ? min : d > max ? max : d);

/** The month `delta` months away, across years. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const i = year * 12 + month + delta;
  return { year: Math.floor(i / 12), month: ((i % 12) + 12) % 12 };
}

/** True when the month has at least one day in [min, max]. */
export const monthInRange = (year: number, month: number, min: string, max: string): boolean =>
  endOfMonth(year, month) >= min && isoOf(year, month, 1) <= max;

/**
 * Where to load soil water for a month: its last day, kept between `min` and the project's
 * `today` (the API computes no report after today + 7, and the load covers ~85 days back).
 */
export const monthAnchor = (year: number, month: number, min: string, today: string): string =>
  clampDate(endOfMonth(year, month), min, today);

/**
 * Where to load soil water for a year view: today in today's year, else the end of August,
 * so the summer (the irrigation season) gets its colors first.
 */
export const yearAnchor = (year: number, min: string, today: string): string =>
  year === Number(today.slice(0, 4)) ? today : clampDate(`${year}-08-31`, min, today);
