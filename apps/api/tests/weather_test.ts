import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { FarmData, StoredWeatherDay } from "../src/modules/irrigation/data/farmData.ts";
import { addDays } from "../src/modules/irrigation/engine/util.ts";
import { createOpenMeteoClient } from "../src/modules/irrigation/weather/openMeteo.ts";
import { createWeatherService } from "../src/modules/irrigation/weather/weatherService.ts";

type Data = Pick<FarmData, "getFarm" | "getWeather" | "getGddClimatology">;

function fakeData(
  dbEnd = "2026-07-15",
  opts: { gddBase6?: number | null; skipLeap?: boolean } = {},
): Data {
  return {
    getFarm: () => Promise.resolve({ id: 1, name: "F", lat: 48.046, lon: 1.794 }),
    getWeather: (from, to) => {
      const out: StoredWeatherDay[] = [];
      for (let d = from; d <= to && d <= dbEnd; d = addDays(d, 1)) {
        out.push({
          date: d,
          et0: 4,
          rain: 0,
          tmin: 12,
          tmean: 20,
          gddBase0: 20,
          gddBase5: 15,
          gddBase6: opts.gddBase6 === undefined ? 13 : opts.gddBase6,
          gddBase10: 10,
        });
      }
      return Promise.resolve(out);
    },
    getGddClimatology: () => {
      const m = new Map<string, number>();
      for (let d = "2024-01-01"; d <= "2024-12-31"; d = addDays(d, 1)) {
        if (opts.skipLeap && d.endsWith("02-29")) continue;
        m.set(d.slice(5), 14);
      }
      return Promise.resolve(m);
    },
  };
}

function fakeFetch(calls: string[], opts: { status?: number } = {}): typeof fetch {
  return (input) => {
    const url = String(input);
    calls.push(url);
    if (opts.status && opts.status !== 200) {
      return Promise.resolve(new Response("boom", { status: opts.status }));
    }
    const u = new URL(url);
    const s = u.searchParams.get("start_date")!;
    const e = u.searchParams.get("end_date")!;
    const time: string[] = [];
    for (let d = s; d <= e; d = addDays(d, 1)) time.push(d);
    return Promise.resolve(Response.json({
      daily: {
        time,
        et0_fao_evapotranspiration: time.map(() => 5),
        precipitation_sum: time.map(() => 1),
        temperature_2m_min: time.map(() => 14),
        temperature_2m_mean: time.map(() => 22),
      },
    }));
  };
}

Deno.test("range inside DB: no fetch, all db", async () => {
  const calls: string[] = [];
  const svc = createWeatherService({ data: fakeData(), fetch: fakeFetch(calls) });
  const days = await svc.getDailySeries({ from: "2026-07-01", to: "2026-07-10", gddBase: 6 });
  assertEquals(calls.length, 0);
  assertEquals(days.length, 10);
  assertEquals(days.every((d) => d.source === "db" && d.gdd === 13), true);
});

Deno.test("gap after DB end is filled from Open-Meteo", async () => {
  const calls: string[] = [];
  const svc = createWeatherService({ data: fakeData(), fetch: fakeFetch(calls) });
  const days = await svc.getDailySeries({ from: "2026-07-14", to: "2026-07-18", gddBase: 6 });
  assertEquals(calls.length, 1);
  const u = new URL(calls[0]);
  assertEquals(u.searchParams.get("start_date"), "2026-07-16");
  assertEquals(u.searchParams.get("end_date"), "2026-07-18");
  assertEquals(days.map((d) => d.date), [
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
    "2026-07-17",
    "2026-07-18",
  ]);
  assertEquals(days.map((d) => d.source), ["db", "db", "open-meteo", "open-meteo", "open-meteo"]);
  assertEquals(days[2].gdd, 16);
  assertEquals(days[0].gdd, 13);
});

Deno.test("inverted range: no fetch, empty", async () => {
  const calls: string[] = [];
  const svc = createWeatherService({ data: fakeData(), fetch: fakeFetch(calls) });
  assertEquals(await svc.getDailySeries({ from: "2026-07-18", to: "2026-07-14", gddBase: 6 }), []);
  assertEquals(calls.length, 0);
});

Deno.test("URL has farm coordinates and timezone=auto", async () => {
  const calls: string[] = [];
  const svc = createWeatherService({ data: fakeData(), fetch: fakeFetch(calls) });
  await svc.getDailySeries({ from: "2026-07-16", to: "2026-07-17", gddBase: 6 });
  assertStringIncludes(calls[0], "latitude=48.046");
  assertStringIncludes(calls[0], "longitude=1.794");
  assertStringIncludes(calls[0], "timezone=auto");
});

Deno.test("null handling: drops null et0/temps, null rain becomes 0", async () => {
  const f: typeof fetch = () =>
    Promise.resolve(Response.json({
      daily: {
        time: ["2026-07-16", "2026-07-17", "2026-07-18"],
        et0_fao_evapotranspiration: [null, 4, 4],
        precipitation_sum: [1, null, 2],
        temperature_2m_min: [10, 10, null],
        temperature_2m_mean: [18, 18, 18],
      },
    }));
  const c = createOpenMeteoClient({ fetch: f });
  const days = await c.fetchDaily({ lat: 1, lon: 2, start: "2026-07-16", end: "2026-07-18" });
  assertEquals(days, [{ date: "2026-07-17", et0: 4, rain: 0, tmin: 10, tmean: 18 }]);
});

Deno.test("cache hit, TTL expiry, errors not cached", async () => {
  const calls: string[] = [];
  let t = 0;
  const c = createOpenMeteoClient({ fetch: fakeFetch(calls), now: () => t });
  const p = { lat: 48.046, lon: 1.794, start: "2026-07-16", end: "2026-07-17" };
  await c.fetchDaily(p);
  await c.fetchDaily({ ...p, lat: 48.0461 });
  assertEquals(calls.length, 1);
  t = 6 * 3600_000 + 1;
  await c.fetchDaily(p);
  assertEquals(calls.length, 2);

  const errCalls: string[] = [];
  const bad = createOpenMeteoClient({ fetch: fakeFetch(errCalls, { status: 500 }) });
  await assertRejects(() => bad.fetchDaily(p), Error, "Open-Meteo 500: boom");
  await assertRejects(() => bad.fetchDaily(p), Error, "Open-Meteo 500: boom");
  assertEquals(errCalls.length, 2);
});

Deno.test("seasonGddTotal: MAIZ 04-16..10-17 = 14 x 185", async () => {
  const svc = createWeatherService({ data: fakeData(), fetch: fakeFetch([]) });
  const known: { date: string; gdd: number }[] = [];
  for (let d = "2026-04-16"; d <= "2026-07-15"; d = addDays(d, 1)) known.push({ date: d, gdd: 14 });
  const total = await svc.seasonGddTotal({
    sowing: "2026-04-16",
    harvest: "2026-10-17",
    gddBase: 6,
    knownDays: known,
  });
  assertEquals(total, 14 * 185);
});

Deno.test("stored gdd column null falls back to max(0, tmean - base)", async () => {
  const svc = createWeatherService({
    data: fakeData("2026-07-15", { gddBase6: null }),
    fetch: fakeFetch([]),
  });
  const days = await svc.getDailySeries({ from: "2026-07-01", to: "2026-07-02", gddBase: 6 });
  assertEquals(days.map((d) => d.gdd), [14, 14]);
  const hot = await svc.getDailySeries({ from: "2026-07-01", to: "2026-07-02", gddBase: 25 });
  assertEquals(hot.map((d) => d.gdd), [0, 0]);
});

Deno.test("seasonGddTotal: missing 02-29 climatology falls back to 02-28", async () => {
  const svc = createWeatherService({
    data: fakeData("2026-07-15", { skipLeap: true }),
    fetch: fakeFetch([]),
  });
  const total = await svc.seasonGddTotal({
    sowing: "2028-02-27",
    harvest: "2028-03-01",
    gddBase: 6,
    knownDays: [],
  });
  assertEquals(total, 14 * 4);
});
