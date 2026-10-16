// Marceau's reference case (seed/fao56/fao56_README.md, "Demo case recomputed"), on the real
// AgERA5 Loiret 2022 weather. Expected values were reproduced with the same method before coding:
// flowering 12 July (854 °C·d), TAW 144, D ≈ 49 mm on the morning of 13 July (Marceau: 97 of 144 left),
// RAW ≈ 65 (p capped at 0.45 at flowering), stress from 15 July. Season to 12 July: rain 149,
// drainage 22, 0 stress days.
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { createMemoryFarmData } from "../src/modules/irrigation/data/memoryFarmData";
import { createIrrigationService } from "../src/modules/irrigation/irrigation.service";
import { createWeatherService } from "../src/modules/irrigation/weather/weatherService";
import { makeReference2022Fixture } from "./fixtures/fao";

function service(opts: { withJuly9Watering?: boolean } = {}) {
  const data = createMemoryFarmData(makeReference2022Fixture(opts));
  const weather = createWeatherService({
    data,
    fetch: () => Promise.reject(new Error("2022 is in the DB: no Open-Meteo call expected")),
  });
  return createIrrigationService({ data, weather, today: () => "2026-10-17" });
}

const between = (v: number, lo: number, hi: number, label: string) =>
  assert(v >= lo && v <= hi, `${label}: ${v} not in [${lo}, ${hi}]`);

Deno.test("reference 2022: stage on 13 July — flowering reached on 12 July", async () => {
  const r = await service().getFieldReport(10, "2022-07-13");
  assertEquals(r.stage?.phase, "mid");
  assertAlmostEquals(r.stage!.gddSinceSowing, 854, 2);
  assertEquals(r.stage?.floweringDate, "2022-07-12");
  assertEquals(r.stage?.sensitive, true);
  assertEquals(r.rootDepthM, 1.2);
});

Deno.test("reference 2022: soil reserve from FAO Table 19 (sandy loam)", async () => {
  const r = await service().getFieldReport(10, "2022-07-13");
  assertEquals(r.soil?.textureClass, "Sandy loam");
  assertAlmostEquals(r.tawMm, 144, 0.5);
});

Deno.test("reference 2022: water left and threshold on 13 July", async () => {
  const r = await service().getFieldReport(10, "2022-07-13");
  between(r.depletionMm, 46, 52, "depletion"); // 95 of 144 left (Marceau: 97)
  assertAlmostEquals(r.rawMm, 64.8, 1); // p 0.45 at flowering
  assertEquals(r.decision, "plan_irrigation");
  assertEquals(r.irrigateBy, "2022-07-15");
  assertEquals(r.daysUntilIrrigation, 2);
  assertEquals(r.irrigateGrossMm, 40); // one pass of the reel gun
  assertAlmostEquals(r.irrigateMm, 30, 0.5);
});

Deno.test("reference 2022: season totals since sowing", async () => {
  const s = (await service().getFieldReport(10, "2022-07-13")).season!;
  assertEquals(s.daysSinceSowing, 71);
  assertAlmostEquals(s.rainMm, 149, 1);
  assertEquals(s.irrigationGrossMm, 35);
  assertAlmostEquals(s.irrigationNetMm, 26.25, 0.1);
  assertAlmostEquals(s.drainageMm, 22, 1);
  assertEquals(s.stressDays, 0);
  between(s.etcMm, 195, 215, "ETc"); // Marceau: 209
});

Deno.test("reference 2022: the 9 July watering matters — without it, irrigate today", async () => {
  const r = await service({ withJuly9Watering: false }).getFieldReport(10, "2022-07-13");
  assertEquals(r.decision, "irrigate_today");
  between(r.depletionMm, 72, 79, "depletion without the watering");
});

Deno.test("reference 2022: series = 10 days back + 5 days ahead, with drainage and p", async () => {
  const r = await service().getFieldReport(10, "2022-07-13");
  const series = r.series!;
  assertEquals(series.length, 16);
  assertEquals(series[0].date, "2022-07-03");
  assertEquals(series[series.length - 1].date, "2022-07-18");
  const july9 = series.find((d) => d.date === "2022-07-09")!;
  assertAlmostEquals(july9.irrigation, 26.25, 1e-9);
  assert(series.every((d) => typeof d.drainage === "number" && typeof d.p === "number"));
});

Deno.test("reference 2022: assumptions are listed for the farmer and the jury", async () => {
  const r = await service().getFieldReport(10, "2022-07-13");
  const text = r.assumptions!.join(" ").toLowerCase();
  assert(text.includes("rain"), text);
  assert(text.includes("start"), text);
});

Deno.test("reference 2022: after flowering + 590 °C·d the crop is maturing", async () => {
  // 1440 °C·d is reached around 17 August; the weather file ends 31 August (asOf + 7 must fit).
  const r = await service().getFieldReport(10, "2022-08-20");
  assertEquals(r.decision, "crop_maturing");
  assertEquals(r.irrigateGrossMm, 0);
});

Deno.test("reference 2022: farm advice gives the short version (no series, no season)", async () => {
  const advice = await service().getFarmAdvice("2022-07-13");
  assertEquals(advice.reports.length, 1);
  assertEquals(advice.reports[0].decision, "plan_irrigation");
  assertEquals(advice.reports[0].series, undefined);
  assertEquals(advice.reports[0].season, undefined);
});
