// Weather service: DB history merged with Open-Meteo for the days the DB lacks,
// GDD per day, and season GDD totals using climatology for days still to come.

import type { WeatherDay } from "@tellia/shared/irrigation";
import type { FarmData, StoredWeatherDay } from "../data/farmData";
import { addDays, daysBetween } from "../engine/util";
import { createOpenMeteoClient, type OpenMeteoClient } from "./openMeteo";

/** Internal: a weather day plus its growing degree-days. */
export type WeatherDayGdd = WeatherDay & { gdd: number };

export interface DailySeriesParams {
  from: string;
  to: string;
  gddBase: number;
}

export interface SeasonGddParams {
  sowing: string;
  harvest: string;
  gddBase: number;
  knownDays: { date: string; gdd: number }[];
}

export interface WeatherService {
  getDailySeries(params: DailySeriesParams): Promise<WeatherDayGdd[]>;
  seasonGddTotal(params: SeasonGddParams): Promise<number>;
}

function storedGdd(day: StoredWeatherDay, base: number): number {
  const col = base === 0
    ? day.gddBase0
    : base === 5
    ? day.gddBase5
    : base === 6
    ? day.gddBase6
    : base === 10
    ? day.gddBase10
    : null;
  return col ?? Math.max(0, day.tmean - base);
}

export function createWeatherService(
  deps: {
    data: Pick<FarmData, "getFarm" | "getWeather" | "getGddClimatology">;
    client?: OpenMeteoClient;
    fetch?: typeof fetch;
    now?: () => number;
  },
): WeatherService {
  const client = deps.client ?? createOpenMeteoClient({ fetch: deps.fetch, now: deps.now });
  const { data } = deps;

  return {
    async getDailySeries({ from, to, gddBase }) {
      if (from > to) return [];
      const stored = await data.getWeather(from, to);
      const days: WeatherDayGdd[] = stored
        .filter((d) => d.date >= from && d.date <= to)
        .map((d) => ({
          date: d.date,
          et0: d.et0,
          rain: d.rain,
          tmin: d.tmin,
          tmean: d.tmean,
          gdd: storedGdd(d, gddBase),
          source: "db" as const,
        }));
      const lastDb = days.length ? days[days.length - 1].date : null;
      const gapStart = lastDb ? addDays(lastDb, 1) : from;
      if (gapStart <= to) {
        const farm = await data.getFarm();
        const fetched = await client.fetchDaily({
          lat: farm.lat,
          lon: farm.lon,
          start: gapStart,
          end: to,
        });
        for (const d of fetched) {
          if (d.date < gapStart || d.date > to) continue;
          days.push({
            ...d,
            gdd: Math.max(0, d.tmean - gddBase),
            source: "open-meteo" as const,
          });
        }
      }
      return days.sort((a, b) => a.date.localeCompare(b.date));
    },

    async seasonGddTotal({ sowing, harvest, gddBase, knownDays }) {
      const known = knownDays.filter((d) => d.date >= sowing && d.date <= harvest);
      let total = known.reduce((s, d) => s + d.gdd, 0);
      const lastKnown = known.reduce((m, d) => (d.date > m ? d.date : m), addDays(sowing, -1));
      const remaining = daysBetween(lastKnown, harvest);
      if (remaining > 0) {
        const clim = await data.getGddClimatology(gddBase);
        for (let i = 1; i <= remaining; i++) {
          total += clim.get(addDays(lastKnown, i).slice(5)) ?? 0;
        }
      }
      return total;
    },
  };
}
