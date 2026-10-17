// resolveField from what speech-to-text wrote: French names come back spelled by ear.
import { assertEquals } from "@std/assert";
import { createMemoryFarmData } from "../src/modules/irrigation/data/memoryFarmData";
import { createIrrigationService } from "../src/modules/irrigation/irrigation.service";
import { createWeatherService } from "../src/modules/irrigation/weather/weatherService";
import { makeFarmFixture } from "./fixtures/farm";

function service() {
  const data = createMemoryFarmData(makeFarmFixture());
  const weather = createWeatherService({
    data,
    fetch: () => Promise.reject(new Error("no Open-Meteo call expected")),
  });
  return createIrrigationService({ data, weather, today: () => "2026-07-05" });
}

const ids = async (query: string) => (await service().resolveField(query)).map((m) => m.fieldId);

Deno.test("resolveField: exact and partial names still win", async () => {
  assertEquals((await ids("Le Puits"))[0], 11);
  assertEquals((await ids("la vallée"))[0], 10);
  assertEquals((await ids("longues raies"))[0], 3);
});

Deno.test("resolveField: names heard by ear (call log 2026-10-17: 'Le Puy')", async () => {
  assertEquals((await ids("Le Puy"))[0], 11);
  assertEquals((await ids("le puit"))[0], 11);
  assertEquals((await ids("the valley"))[0], 10);
  assertEquals((await ids("Les Longue Rays"))[0], 3);
});

Deno.test("resolveField: articles alone match nothing", async () => {
  // "Le Puy" must not also pull in every field whose name starts with "Le"/"La"/"Les".
  assertEquals(await ids("Le Puy"), [11]);
  assertEquals(await ids("le truc"), []);
});
