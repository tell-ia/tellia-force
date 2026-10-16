// Open-Meteo historical-forecast client: daily series for a location and date range.
// Serves 2021 through today + 14 days. In-memory cache, 6 h TTL, failures never cached.

import { z } from "zod";

export const OPEN_METEO_URL = "https://historical-forecast-api.open-meteo.com/v1/forecast";
export const OPEN_METEO_TTL_MS = 6 * 60 * 60 * 1000;
export const OPEN_METEO_TIMEOUT_MS = 8000;

export interface OpenMeteoDay {
  date: string;
  et0: number;
  rain: number;
  tmin: number;
  tmean: number;
  /** Daily max temperature, for degree-days. Absent when Open-Meteo has no value. */
  tmax?: number;
}

export interface OpenMeteoClient {
  fetchDaily(
    params: { lat: number; lon: number; start: string; end: string },
  ): Promise<OpenMeteoDay[]>;
}

const nullableNumbers = z.array(z.number().nullable());
const ResponseSchema = z.object({
  daily: z.object({
    time: z.array(z.string()),
    et0_fao_evapotranspiration: nullableNumbers,
    precipitation_sum: nullableNumbers,
    temperature_2m_min: nullableNumbers,
    temperature_2m_mean: nullableNumbers,
    temperature_2m_max: nullableNumbers.optional(),
  }),
});

export function createOpenMeteoClient(opts: {
  fetch?: typeof fetch;
  now?: () => number;
  ttlMs?: number;
  timeoutMs?: number;
} = {}): OpenMeteoClient {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? OPEN_METEO_TTL_MS;
  const timeoutMs = opts.timeoutMs ?? OPEN_METEO_TIMEOUT_MS;
  const cache = new Map<string, { at: number; days: OpenMeteoDay[] }>();

  return {
    async fetchDaily({ lat, lon, start, end }) {
      const rLat = lat.toFixed(2);
      const rLon = lon.toFixed(2);
      const key = `${rLat},${rLon},${start},${end}`;
      const hit = cache.get(key);
      if (hit && now() - hit.at < ttlMs) return hit.days.map((d) => ({ ...d }));

      const url = new URL(OPEN_METEO_URL);
      url.searchParams.set("latitude", String(lat));
      url.searchParams.set("longitude", String(lon));
      url.searchParams.set(
        "daily",
        "et0_fao_evapotranspiration,precipitation_sum,temperature_2m_min,temperature_2m_mean," +
          "temperature_2m_max",
      );
      url.searchParams.set("timezone", "auto");
      url.searchParams.set("start_date", start);
      url.searchParams.set("end_date", end);

      const res = await doFetch(url.toString(), { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) {
        throw new Error(`Open-Meteo ${res.status}: ${await res.text()}`);
      }
      const { daily } = ResponseSchema.parse(await res.json());
      const days: OpenMeteoDay[] = [];
      daily.time.forEach((date, i) => {
        const et0 = daily.et0_fao_evapotranspiration[i];
        const tmin = daily.temperature_2m_min[i];
        const tmean = daily.temperature_2m_mean[i];
        if (et0 == null || tmin == null || tmean == null) return;
        const tmax = daily.temperature_2m_max?.[i];
        days.push({
          date,
          et0,
          rain: daily.precipitation_sum[i] ?? 0,
          tmin,
          tmean,
          ...(tmax != null ? { tmax } : {}),
        });
      });
      cache.set(key, { at: now(), days });
      return days.map((d) => ({ ...d }));
    },
  };
}
