// Pure helpers for the farm reel-gun plan. No React, no fetch.

/** What the per-day split needs from a scheduled reel run (hours from asOf 00:00). */
export interface RunWater {
  passIndex: number;
  startHour: number;
  endHour: number;
  grossMm: number;
}

const MAX_EVENTS = 10; // the simulate endpoint takes at most 10 events
const round1 = (n: number) => Math.round(n * 10) / 10;
const addDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * A field's water as daily irrigation events, on the days the gun actually pumps it. A big field
 * takes several runs (one strip each); a run waters only its share of the field (1 / runs in its
 * pass), spread over its hours and split at midnight. So a pass whose first run is today puts
 * water on today — the reserve starts climbing the day the card says "Irrigate now" — instead of
 * all of it on the day the last run ends. Field-average gross mm; slivers under 1 mm are dropped
 * (the engine refuses 0 mm) and only the first 10 days are kept (the endpoint's limit; the
 * weather runs out well before).
 */
export function waterEventsByDay(runs: readonly RunWater[], asOf: string): { date: string; grossMm: number }[] {
  const runsInPass = new Map<number, number>();
  for (const r of runs) runsInPass.set(r.passIndex, (runsInPass.get(r.passIndex) ?? 0) + 1);
  const byDay = new Map<number, number>();
  for (const r of runs) {
    const dur = r.endHour - r.startHour;
    if (dur <= 0) continue;
    const mm = r.grossMm / runsInPass.get(r.passIndex)!;
    for (let day = Math.floor(r.startHour / 24); day * 24 < r.endHour; day++) {
      const hours = Math.min(r.endHour, (day + 1) * 24) - Math.max(r.startHour, day * 24);
      if (hours > 0) byDay.set(day, (byDay.get(day) ?? 0) + (mm * hours) / dur);
    }
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, mm]) => Math.round(mm) >= 1)
    .slice(0, MAX_EVENTS)
    .map(([day, mm]) => ({ date: addDaysIso(asOf, day), grossMm: round1(mm) }));
}

/**
 * mm a field is still below comfort at the end of each grid day (day 0 = asOf), from the reserve
 * re-simulated on the plan's real run days and weather: threshold − reserve, 0 once above. It
 * can climb back up the days the gun is elsewhere. Past the simulation (the weather runs out) it
 * carries on from the last simulated day at `climbPerDay` (what the rotation gains on the crop,
 * mm/day; ≤ 0 = it keeps sinking); with no simulation, from `todayGap` (start of today).
 */
export function comfortGaps(
  series: readonly { date: string; reserveMm: number }[],
  asOf: string,
  thresholdMm: number,
  days: number,
  todayGap: number,
  climbPerDay: number,
): number[] {
  const byDate = new Map(series.map((p) => [p.date, p.reserveMm]));
  const gaps: number[] = [];
  let last = { day: -1, gap: todayGap };
  for (let d = 0; d < days; d++) {
    const reserve = byDate.get(addDaysIso(asOf, d));
    const raw = reserve !== undefined ? thresholdMm - reserve : last.gap - climbPerDay * (d - last.day);
    if (reserve !== undefined) last = { day: d, gap: raw };
    gaps.push(Math.max(0, Math.round(raw)));
  }
  return gaps;
}

/** The first grid day that ends above comfort (green from there on the calendar), or null. */
export function firstComfortDay(gaps: readonly number[]): number | null {
  const d = gaps.findIndex((g) => g === 0);
  return d < 0 ? null : d;
}

/** Share of a field the gun waters on grid `day`: each run covers 1 / runs in its pass, by the hours it pumps that day. */
export function fieldShareOnDay(runs: readonly RunWater[], day: number): number {
  const runsInPass = new Map<number, number>();
  for (const r of runs) runsInPass.set(r.passIndex, (runsInPass.get(r.passIndex) ?? 0) + 1);
  let share = 0;
  for (const r of runs) {
    const dur = r.endHour - r.startHour;
    const hours = Math.min(r.endHour, (day + 1) * 24) - Math.max(r.startHour, day * 24);
    if (dur > 0 && hours > 0) share += hours / dur / runsInPass.get(r.passIndex)!;
  }
  return share;
}

const FRACTIONS: [number, string][] = [[1 / 4, "¼"], [1 / 3, "⅓"], [1 / 2, "½"], [2 / 3, "⅔"], [3 / 4, "¾"]];

/**
 * "½" for half the field: the nearest simple fraction (it has to fit a calendar cell), "<¼" for
 * a sliver; null when (nearly) the whole field is watered that day.
 */
export function shareLabel(share: number): string | null {
  if (share >= 0.875) return null;
  if (share < 0.2) return "<¼";
  return FRACTIONS.reduce((best, f) => (Math.abs(share - f[0]) < Math.abs(share - best[0]) ? f : best))[1];
}
