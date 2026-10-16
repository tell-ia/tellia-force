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
    /** Process-level cache lifetime for series and season totals. Default 10 minutes. */
    cacheTtlMs?: number;
  },
): WeatherService {
  const client = deps.client ?? createOpenMeteoClient({ fetch: deps.fetch, now: deps.now });
  const { data } = deps;
  const now = deps.now ?? Date.now;
  const ttl = deps.cacheTtlMs ?? 10 * 60 * 1000;
  const cache = new Map<string, { at: number; value: Promise<unknown> }>();

  /** Caches the in-flight promise (so concurrent callers share it); failures are evicted. */
  function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const t = now();
    const hit = cache.get(key);
    if (hit && t - hit.at < ttl) return hit.value as Promise<T>;
    const value = load();
    cache.set(key, { at: t, value });
    value.catch(() => {
      if (cache.get(key)?.value === value) cache.delete(key);
    });
    return value;
  }

  return {
    getDailySeries: (p) => cached(`series:${p.from}:${p.to}:${p.gddBase}`, () => loadSeries(p)),
    seasonGddTotal: (p) =>
      cached(
        `total:${p.sowing}:${p.harvest}:${p.gddBase}:${JSON.stringify(p.knownDays)}`,
        () => loadTotal(p),
      ),
  };

  async function loadSeries({ from, to, gddBase }: DailySeriesParams) {
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
  }

  async function loadTotal({ sowing, harvest, gddBase, knownDays }: SeasonGddParams) {
      const known = knownDays.filter((d) => d.date >= sowing && d.date <= harvest);
      let total = known.reduce((s, d) => s + d.gdd, 0);
      const lastKnown = known.reduce((m, d) => (d.date > m ? d.date : m), addDays(sowing, -1));
      const remaining = daysBetween(lastKnown, harvest);
      if (remaining > 0) {
        const clim = await data.getGddClimatology(gddBase);
        for (let i = 1; i <= remaining; i++) {
          const md = addDays(lastKnown, i).slice(5);
          total += clim.get(md) ?? (md === "02-29" ? clim.get("02-28") : undefined) ?? 0;
        }
      }
      return total;
  }
}
