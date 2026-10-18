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
