// Today's brief as an SMS: the same advice and words as the app's Today screen. Pure.
import type { FieldReport, WeatherDay } from "@tellia/shared/irrigation";

/** The farm's weather around the date (one region for all its fields). */
export interface BriefWeather {
  /** The next days after the date (forecast, or what came next on a past demo date). */
  next: Pick<WeatherDay, "rain" | "et0" | "tmean" | "tmax">[];
  /** Rain and evaporation (ET0) summed over the 30 days before the date. */
  past30: { rainMm: number; et0Mm: number; days: number };
}

/** "Next 3 days: no rain, up to 34 °C, about 5 mm a day of evaporation." */
function forecastLine(next: BriefWeather["next"]): string | null {
  if (next.length === 0) return null;
  const rain = next.reduce((s, d) => s + d.rain, 0);
  const hot = Math.max(...next.map((d) => d.tmax ?? d.tmean));
  const et0 = next.reduce((s, d) => s + d.et0, 0) / next.length;
  const rainText = rain < 1 ? "no rain" : `${Math.round(rain)} mm of rain`;
  return `Next ${next.length} days: ${rainText}, up to ${Math.round(hot)} °C, about ${Math.round(et0)} mm a day of evaporation.`;
}

/** A dry spell (rain under 30 % of evaporation) or a wet one (more rain than evaporation); else null. */
function spellLine(p: BriefWeather["past30"]): string | null {
  if (p.days < 20 || p.et0Mm <= 0) return null; // not enough weather to judge
  const facts = `${Math.round(p.rainMm)} mm of rain in the last 30 days for ${Math.round(p.et0Mm)} mm of evaporation.`;
  if (p.rainMm < 0.3 * p.et0Mm) return `Dry spell: ${facts}`;
  if (p.rainMm > p.et0Mm) return `Wet spell: ${facts}`;
  return null;
}

const day = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });

/** "Wed 15 Jul" */
const shortDate = (iso: string) => `${day(iso, { weekday: "short" })} ${day(iso, { day: "numeric", month: "short" })}`;

/** Fields to water: equipped, and the advice says today or by a date (the Today screen's "action"). */
const toWater = (r: FieldReport) =>
  r.irrigable && (r.decision === "irrigate_today" || r.decision === "plan_irrigation");

export function briefText(
  input: { farmName: string; firstName: string; asOf: string; reports: FieldReport[]; weather?: BriefWeather },
): string {
  const act = input.reports.filter(toWater);
  const greeting = `Good morning, ${input.firstName || "there"}. ` +
    (act.length === 0
      ? "Nothing urgent today: all fields on track."
      : act.length === 1
      ? "One field needs water:"
      : `${act.length} fields need water:`);
  const lines = act.map((r) => {
    const when = r.decision === "irrigate_today" || !r.irrigateBy ? "today" : `by ${shortDate(r.irrigateBy)}`;
    return `- ${r.fieldName}: ${r.irrigateGrossMm} mm ${when}`;
  });
  return [
    `Tellia · ${input.farmName} · ${shortDate(input.asOf)}`,
    greeting,
    ...lines,
    ...(input.weather ? [forecastLine(input.weather.next), spellLine(input.weather.past30)].filter((l): l is string => !!l) : []),
    "Reply here to log a watering or ask a question.",
  ].join("\n");
}
