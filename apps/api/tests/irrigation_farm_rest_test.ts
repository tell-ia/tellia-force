// `?farmId=` picks the farm on the REST routes (the phone / Vapi tools call these).
// Without it, farm 1 is served, as before.
import { assertEquals } from "@std/assert";
import { Hono } from "hono";
import { onError } from "../src/core/middleware";
import { createMemoryFarmData } from "../src/modules/irrigation/data/memoryFarmData";
import { createIrrigationController } from "../src/modules/irrigation/irrigation.controller";
import { createIrrigationService } from "../src/modules/irrigation/irrigation.service";
import { createWeatherService } from "../src/modules/irrigation/weather/weatherService";
import { makeFarmFixture } from "./fixtures/farm";

function serviceFor(edit: (f: ReturnType<typeof makeFarmFixture>) => void) {
  const fixture = makeFarmFixture();
  edit(fixture);
  const data = createMemoryFarmData(fixture);
  const weather = createWeatherService({
    data,
    fetch: () => Promise.reject(new Error("no network expected")),
  });
  return createIrrigationService({ data, weather, today: () => "2026-07-05" });
}

function makeApp() {
  const farm1 = serviceFor(() => {});
  const farm2 = serviceFor((f) => {
    f.farm = { id: 2, name: "SAT Los Olmos", lat: 41.6, lon: -4.9 };
    f.fields = f.fields.map((x) => ({ ...x, name: `${x.name} (ES)` }));
  });
  const farms = new Map([[1, farm1], [2, farm2]]);
  const app = new Hono();
  app.onError(onError);
  app.route(
    "/irrigation",
    createIrrigationController(farm1, { forFarm: (id) => farms.get(id) ?? null }),
  );
  return app;
}

Deno.test("farmId: advice for farm 2 returns farm 2's fields", async () => {
  const res = await makeApp().request("/irrigation/advice?farmId=2");
  assertEquals(res.status, 200);
  const names = (await res.json()).data.reports.map((r: { fieldName: string }) => r.fieldName);
  assertEquals(names.every((n: string) => n.endsWith("(ES)")), true);
});

Deno.test("farmId: no farmId → farm 1, as before", async () => {
  const res = await makeApp().request("/irrigation/advice");
  const names = (await res.json()).data.reports.map((r: { fieldName: string }) => r.fieldName);
  assertEquals(names.some((n: string) => n.endsWith("(ES)")), false);
});

Deno.test("farmId: works on the field report too", async () => {
  const res = await makeApp().request("/irrigation/fields/10/report?farmId=2");
  assertEquals(res.status, 200);
  assertEquals((await res.json()).data.fieldName, "La Vallée (ES)");
});

Deno.test("farmId: unknown farm → 404", async () => {
  assertEquals((await makeApp().request("/irrigation/advice?farmId=9")).status, 404);
});

Deno.test("farmId: not a number → 400", async () => {
  assertEquals((await makeApp().request("/irrigation/advice?farmId=abc")).status, 400);
});
