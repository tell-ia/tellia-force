// Service rules of the FAO-56 path that the reference case does not cover: scenario series,
// dry-region start, no irrigation system, fallback to the old model, Open-Meteo note.
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  createMemoryFarmData,
  type FarmFixture,
} from "../src/modules/irrigation/data/memoryFarmData";
import { createIrrigationService } from "../src/modules/irrigation/irrigation.service";
import { createWeatherService } from "../src/modules/irrigation/weather/weatherService";
import { addDays } from "../src/modules/irrigation/engine/util";
import { makeReference2022Fixture } from "./fixtures/fao";

function service(edit: (f: FarmFixture) => void = () => {}, fetch?: typeof globalThis.fetch) {
  const fixture = makeReference2022Fixture();
  edit(fixture);
  const data = createMemoryFarmData(fixture);
  const weather = createWeatherService({
    data,
    fetch: fetch ?? (() => Promise.reject(new Error("no Open-Meteo call expected"))),
  });
  return createIrrigationService({ data, weather, today: () => "2026-10-17" });
}

Deno.test("fao service: scenario series uses the report's TAW, p and efficiency", async () => {
  const s = service();
  const report = await s.getFieldReport(10, "2022-07-13");
  const sim = await s.simulateScenario(10, [{ type: "hail", date: "2022-07-13" }], "2022-07-13");
  // Hail changes no water: the scenario series is the report series on the shared days.
  const shared = sim.series.filter((d) => d.date >= "2022-07-03" && d.date <= "2022-07-18");
  assertEquals(shared, report.series);
  assertEquals(sim.baseline.decision, "plan_irrigation");
  assertEquals(sim.baseline.series, undefined);

  // A watering added after the date counts (scenarios may add later ones), as net water.
  const more = await s.simulateScenario(
    10,
    [{ type: "irrigation", date: "2022-07-14", mm: 40 }],
    "2022-07-13",
  );
  assertAlmostEquals(more.series.find((d) => d.date === "2022-07-14")!.irrigation, 30, 1e-9);
  assertEquals(more.scenario.decision, "no_irrigation");
});

Deno.test("fao service: a dry region starts with 30 % of the reserve empty", async () => {
  const wet = await service().getFieldReport(10, "2022-05-04");
  const dry = await service((f) => (f.farm.aridityIndex = 0.42)).getFieldReport(10, "2022-05-04");
  // First day TAW = 1000 × (0.23 − 0.11) × root depth at the end of sowing day (≈ 0.2 m).
  const startTaw = dry.series![0].taw;
  assertAlmostEquals(dry.depletionMm - wet.depletionMm, 0.3 * startTaw, 0.1);
  assert(dry.assumptions!.some((a) => a.includes("dry region, aridity 0.42")));
  assert(wet.assumptions!.some((a) => a.includes("soil full at sowing (wet region)")));
  const unknown = await service((f) => (f.farm.aridityIndex = null)).getFieldReport(
    10,
    "2022-05-04",
  );
  assertEquals(unknown.depletionMm, wet.depletionMm);
});

Deno.test("fao service: no irrigation system → water counted in full, old 35 mm cap", async () => {
  const r = await service((f) => (f.irrigationSystems = {})).getFieldReport(10, "2022-07-13");
  assert(r.assumptions!.includes("No irrigation system recorded: pumped water counted in full."));
  assertEquals(r.season!.irrigationNetMm, 35);
  assertEquals(r.irrigateGrossMm, r.irrigateMm);
  assert(r.irrigateMm <= 35);
});

Deno.test("fao service: crop without phase rows → old model, no FAO details", async () => {
  const r = await service((f) => (f.cropPhases = [])).getFieldReport(10, "2022-07-13");
  assertEquals(r.stage, undefined);
  assertEquals(r.series, undefined);
  assertEquals(r.assumptions, undefined);
  assertEquals(r.irrigateGrossMm, r.irrigateMm);
  assert(r.kc !== null);
});

Deno.test("fao service: crop phase method and Open-Meteo days are listed", async () => {
  const lastDbDay = "2022-07-10";
  const fakeFetch: typeof fetch = (input) => {
    const u = new URL(String(input));
    const time: string[] = [];
    for (let d = u.searchParams.get("start_date")!; d <= u.searchParams.get("end_date")!;) {
      time.push(d);
      d = addDays(d, 1);
    }
    return Promise.resolve(Response.json({
      daily: {
        time,
        et0_fao_evapotranspiration: time.map(() => 5),
        precipitation_sum: time.map(() => 0),
        temperature_2m_min: time.map(() => 15),
        temperature_2m_mean: time.map(() => 22),
        temperature_2m_max: time.map(() => 29),
      },
    }));
  };
  const r = await service((f) => {
    f.weather = f.weather.filter((d) => d.date <= lastDbDay);
    f.cropPhases![0].method = "Flowering published (Arvalis).";
  }, fakeFetch).getFieldReport(10, "2022-07-13");
  assert(r.assumptions!.includes("Crop stages: Flowering published (Arvalis)."));
  assert(r.assumptions!.includes("Weather after 2022-07-10 from Open-Meteo."));
});

Deno.test("fao service: the dry-start deficit follows the roots down (2022 season)", async () => {
  const wet = await service().getFieldReport(10, "2022-07-13");
  const dry = await service((f) => (f.farm.aridityIndex = 0.42)).getFieldReport(10, "2022-07-13");
  // With full roots the dry profile is still about 20 mm drier (30 % of the deep soil,
  // minus what the June rains refilled): water now, not by the 15th.
  assert(dry.depletionMm >= wet.depletionMm + 15, `${dry.depletionMm} vs ${wet.depletionMm}`);
  assertEquals(dry.decision, "irrigate_today");
  // The June rains refilled the deep soil instead of draining away.
  assertEquals(dry.season!.drainageMm, 0);
  assert(dry.assumptions!.some((a) => a.includes("down to the full root depth")));
});
