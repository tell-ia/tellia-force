// ISO `YYYY-MM-DD` helpers for display. Computed in UTC so a time zone never shifts a day.

const DAY_MS = 86_400_000;
const utc = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

export function addDays(iso: string, n: number): string {
  return new Date(utc(iso).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/** "Wed 15 Jul 2026" (or "Wed 15 Jul" without the year). */
export function formatDay(iso: string, opts: { year?: boolean } = {}): string {
  const d = utc(iso);
  const weekday = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${weekday} ${day}${opts.year === false ? "" : ` ${d.getUTCFullYear()}`}`;
}

/** "5–20 Jul", or "28 Jul–8 Aug" across two months. */
export function dayRange(from: string, to: string): string {
  const month = (iso: string) => utc(iso).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  const day = (iso: string) => String(utc(iso).getUTCDate());
  return month(from) === month(to)
    ? `${day(from)}–${day(to)} ${month(to)}`
    : `${day(from)} ${month(from)}–${day(to)} ${month(to)}`;
}

/** The device's calendar date: the fallback when the API cannot say what "today" is. */
export function localToday(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
