// The 3 date modes: past (DB only), today (DB + Open-Meteo for the missing days),
// future up to today + 7 (Open-Meteo forecast); later dates are refused.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { HTTPException } from "hono/http-exception";
import { createMemoryFarmData } from "../src/modules/irrigation/data/memoryFarmData";
import { createIrrigationService } from "../src/modules/irrigation/irrigation.service";
import { createWeatherService } from "../src/modules/irrigation/weather/weatherService";
import { addDays } from "../src/modules/irrigation/engine/util";
import { makeFarmFixture } from "./fixtures/farm";

const TODAY = "2026-07-05";
const LAST_DB_DAY = "2026-07-02"; // the seed ran 3 days ago

/** Fake Open-Meteo: records each request and returns the asked days (Tmax included). */
function setup(fixtureEdit: (f: ReturnType<typeof makeFarmFixture>) => void = () => {}) {
  const requests: { start: string; end: string }[] = [];
  const fakeFetch: typeof fetch = (input) => {
    const u = new URL(String(input));
    const start = u.searchParams.get("start_date")!;
    const end = u.searchParams.get("end_date")!;
    requests.push({ start, end });
    const time: string[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) time.push(d);
    return Promise.resolve(Response.json({
      daily: {
        time,
        et0_fao_evapotranspiration: time.map(() => 5),
        precipitation_sum: time.map(() => 0),
        temperature_2m_min: time.map(() => 12),
        temperature_2m_mean: time.map(() => 20),
        temperature_2m_max: time.map(() => 28),
      },
    }));
  };
  const fixture = makeFarmFixture();
  fixture.weather = fixture.weather.filter((d) => d.date <= LAST_DB_DAY);
  fixtureEdit(fixture);
  const data = createMemoryFarmData(fixture);
  const weather = createWeatherService({ data, fetch: fakeFetch });
  const service = createIrrigationService({ data, weather, today: () => TODAY });
  return { service, requests };
}

async function rejection(p: Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HTTPException) return { status: e.status, message: e.message };
    throw e;
  }
  throw new Error("expected rejection");
}

Deno.test("dates: past date covered by the DB → no Open-Meteo call", async () => {
  const { service, requests } = setup();
  const r = await service.getFieldReport(10, "2026-06-20"); // needs weather to 27 June
  assertEquals(requests.length, 0);
  assertEquals(r.asOf, "2026-06-20");
});

Deno.test("dates: today → DB, then Open-Meteo from the day after the last DB day to today + 7", async () => {
  const { service, requests } = setup();
  const r = await service.getFieldReport(10);
  assertEquals(r.asOf, TODAY);
  assertEquals(requests.length, 1);
  assertEquals(requests[0], { start: "2026-07-03", end: "2026-07-12" });
});

Deno.test("dates: past date after the last DB day → Open-Meteo history fills the gap", async () => {
  const { service, requests } = setup();
  await service.getFieldReport(10, "2026-07-04");
  assertEquals(requests[0].start, "2026-07-03");
  assertEquals(requests[0].end, "2026-07-11");
});

Deno.test("dates: future date up to today + 7 uses the forecast", async () => {
  const { service, requests } = setup();
  const r = await service.getFieldReport(10, "2026-07-12");
  assertEquals(r.asOf, "2026-07-12");
  assertEquals(requests[0].end, "2026-07-19"); // today + 14: the Open-Meteo limit
});

Deno.test("dates: after today + 7 → 400, the forecast does not reach that far", async () => {
  const { service } = setup();
  const e = await rejection(service.getFieldReport(10, "2026-07-13"));
  assertEquals(e.status, 400);
  assertStringIncludes(e.message, "7 days");
  assertEquals((await rejection(service.getFarmAdvice("2026-08-01"))).status, 400);
});

Deno.test("dates: waterings recorded after the chosen date are ignored", async () => {
  const later = (f: ReturnType<typeof makeFarmFixture>) =>
    f.irrigations.push({
      operationId: 99,
      fieldId: 10,
      seasonId: 109,
      date: "2026-06-25",
      mm: 100,
      status: "confirmed",
      source: "whatsapp",
      memberId: 1,
    });
  const without = await setup().service.getFieldReport(10, "2026-06-22");
  const withLater = await setup(later).service.getFieldReport(10, "2026-06-22");
  assertEquals(withLater.depletionMm, without.depletionMm);
  assertEquals(withLater.daysUntilIrrigation, without.daysUntilIrrigation);
  assertEquals(withLater.decision, without.decision);
});

Deno.test("dates: the same watering counts once the chosen date reaches it", async () => {
  const later = (f: ReturnType<typeof makeFarmFixture>) =>
    f.irrigations.push({
      operationId: 99,
      fieldId: 10,
      seasonId: 109,
      date: "2026-06-25",
      mm: 100,
      status: "confirmed",
      source: "whatsapp",
      memberId: 1,
    });
  const without = await setup().service.getFieldReport(10, "2026-06-27");
  const withIt = await setup(later).service.getFieldReport(10, "2026-06-27");
  assert(withIt.depletionMm < without.depletionMm);
});
