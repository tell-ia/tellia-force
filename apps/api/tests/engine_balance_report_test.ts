import { assertAlmostEquals, assertEquals } from "@std/assert";
import { runWaterBalance, type WeatherInput } from "../src/modules/irrigation/engine/waterBalance";
import { buildFieldReport, rankReports } from "../src/modules/irrigation/engine/report";
import { addDays } from "../src/modules/irrigation/engine/util";

const TAW = 156;
const P = 0.55;

function days(over: Record<string, Partial<WeatherInput>> = {}, n = 23): WeatherInput[] {
  return Array.from({ length: n }, (_, i) => {
    const date = addDays("2026-06-20", i);
    return { date, et0: 5, rain: 0, tmin: 12, kc: 1.2, ...over[date] };
  });
}

Deno.test("balance: dry days", () => {
  const r = runWaterBalance({ days: days({}, 10), irrigations: [], taw: TAW, p: P });
  assertEquals(r.length, 10);
  assertAlmostEquals(r[9].depletion, 60, 1e-9);
  assertAlmostEquals(r[0].etc, 6, 1e-9);
  assertEquals(r[9].ks, 1);
});

Deno.test("balance: rain and irrigation", () => {
  const r = runWaterBalance({
    days: days({ "2026-06-22": { rain: 20 } }, 5),
    irrigations: [{ date: "2026-06-24", mm: 30 }],
    taw: TAW,
    p: P,
  });
  assertEquals(r.map((d) => d.depletion), [6, 12, 0, 6, 0]);
});

Deno.test("balance: Ks below RAW", () => {
  const r = runWaterBalance({ days: days({}, 17), irrigations: [], taw: TAW, p: P });
  assertAlmostEquals(r[14].depletion, 90, 1e-9);
  const ks = 66 / 70.2;
  assertAlmostEquals(r[15].ks, ks, 1e-9);
  assertAlmostEquals(r[15].depletion, 90 + ks * 6, 1e-9);
});

Deno.test("balance: skips null kc, clamps to TAW, merges same-date irrigation", () => {
  const r = runWaterBalance({
    days: days({ "2026-06-21": { kc: null } }, 3),
    irrigations: [],
    taw: TAW,
    p: P,
  });
  assertEquals(r.map((d) => d.date), ["2026-06-20", "2026-06-22"]);
  const big = runWaterBalance({
    days: days({}, 5).map((d) => ({ ...d, et0: 50 })),
    irrigations: [],
    taw: TAW,
    p: P,
  });
  assertEquals(Math.max(...big.map((d) => d.depletion)) <= TAW, true);
  const m = runWaterBalance({
    days: days({}, 2),
    irrigations: [{ date: "2026-06-20", mm: 1 }, { date: "2026-06-20", mm: 2 }],
    taw: TAW,
    p: P,
  });
  assertEquals(m[0].irrigation, 3);
});

const field = { id: 10, name: "La Vallée", irrigable: true };
const season = { cropCode: "MAIZ" };
function report(
  o: {
    asOf?: string;
    over?: Record<string, Partial<WeatherInput>>;
    irrigations?: { date: string; mm: number }[];
    irrigable?: boolean;
    season?: { cropCode: string } | null;
  } = {},
) {
  return buildFieldReport({
    field: { ...field, irrigable: o.irrigable ?? true },
    season: o.season === undefined ? season : o.season,
    cropName: "Maize",
    days: days(o.over),
    irrigations: o.irrigations ?? [],
    taw: TAW,
    p: P,
    asOf: o.asOf ?? "2026-07-05",
    stageLabel: "Tasselling",
    extraWarnings: [],
  });
}

Deno.test("report: irrigate_today", () => {
  const r = report();
  assertEquals(r.decision, "irrigate_today");
  assertEquals(r.irrigateMm, 90);
  assertEquals(r.depletionMm, 90);
  assertEquals(r.tawMm, 156);
  assertEquals(r.rawMm, 85.8);
  assertEquals(r.depletionPct, 58);
  assertEquals(r.rainNext3DaysMm, 0);
  assertEquals(
    r.reason,
    "Root zone is 58% depleted (90 of 156 mm), above the 55% stress threshold, and only 0 mm of rain is forecast in the next 3 days.",
  );
});

Deno.test("report: wait_for_rain", () => {
  const r = report({ over: { "2026-07-06": { rain: 50 } } });
  assertEquals(r.decision, "wait_for_rain");
  assertEquals(r.irrigateMm, 0);
  assertEquals(
    r.reason,
    "Root zone is 58% depleted, but 50 mm of rain is forecast in the next 3 days, enough to cover most of the 90 mm need.",
  );
});

Deno.test("report: no_irrigation", () => {
  const r = report({ asOf: "2026-06-30" });
  assertEquals(r.decision, "no_irrigation");
  assertEquals(r.depletionMm, 60);
  assertEquals(r.depletionPct, 38);
  assertEquals(r.daysUntilIrrigation, 5);
  assertEquals(
    r.reason,
    "Root zone is only 38% depleted (60 of 156 mm), below the 55% stress threshold; irrigation expected in about 5 days.",
  );
  const r2 = report({ irrigations: [{ date: "2026-07-04", mm: 30 }] });
  assertEquals(r2.decision, "no_irrigation");
  assertEquals(r2.depletionMm, 60);
  const r3 = report({ asOf: "2026-06-20" });
  assertEquals(r3.depletionMm, 0);
  assertEquals(r3.daysUntilIrrigation, null);
  assertEquals(
    r3.reason,
    "Root zone is only 0% depleted (0 of 156 mm), below the 55% stress threshold.",
  );
});

Deno.test("report: frost_hold", () => {
  const r = report({ over: { "2026-07-05": { tmin: -1 } } });
  assertEquals(r.decision, "frost_hold");
  assertEquals(r.irrigateMm, 90);
  assertEquals(r.warnings.includes("Frost forecast today (min -1 °C)."), true);
  assertEquals(
    r.reason,
    "Frost is forecast today (min -1 °C): irrigate 90 mm once temperatures are above 0 °C.",
  );
});

Deno.test("report: not_irrigable and outside_season", () => {
  const r = report({ irrigable: false });
  assertEquals(r.decision, "not_irrigable");
  assertEquals(r.irrigateMm, 0);
  assertEquals(r.depletionMm, 90);
  assertEquals(r.reason, "Field is not irrigable; root zone is 58% depleted (90 of 156 mm).");
  const o = report({ season: null });
  assertEquals(o.decision, "outside_season");
  assertEquals(o.reason, "No crop is growing on La Vallée on 2026-07-05.");
});

Deno.test("rankReports", () => {
  const a = report({ asOf: "2026-06-30" });
  const b = report();
  const c = report({ over: { "2026-07-06": { rain: 50 } } });
  const d = report({ irrigable: false });
  const e = report({ season: null });
  const f = report({ asOf: "2026-06-25" });
  const ranked = rankReports([e, d, a, c, f, b]);
  assertEquals(ranked.map((r) => r.decision), [
    "irrigate_today",
    "wait_for_rain",
    "no_irrigation",
    "no_irrigation",
    "not_irrigable",
    "outside_season",
  ]);
  assertEquals(ranked[2].depletionPct >= ranked[3].depletionPct, true);
});

Deno.test("report: frost tmin is rounded to 1 decimal in warning and reason", () => {
  const r = report({ over: { "2026-07-05": { tmin: -1.25 } } });
  assertEquals(r.decision, "frost_hold");
  assertEquals(r.warnings.includes("Frost forecast today (min -1.2 °C)."), true);
  assertEquals(r.reason.includes("(min -1.2 °C)"), true);
});
