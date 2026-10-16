import { assertEquals } from "@std/assert";
import { ScenarioEventSchema } from "@tellia/shared/irrigation";
import { applyScenario, compareReports } from "../src/modules/irrigation/engine/scenario";

const days = [1, 2, 3, 4, 5].map((d) => ({
  date: `2026-07-0${d}`,
  et0: 5,
  rain: 2,
  tmin: 10,
  kc: 1.2,
}));
const ev = (e: unknown) => ScenarioEventSchema.parse(e);

Deno.test("rain adds to the right day without mutation", () => {
  const snap = structuredClone(days);
  const r = applyScenario(days, [], [ev({ type: "rain", date: "2026-07-02", mm: 25 })]);
  assertEquals(r.days[1].rain, 27);
  assertEquals(r.days[0].rain, 2);
  assertEquals(days, snap);
});

Deno.test("flood default", () => {
  const r = applyScenario(days, [], [ev({ type: "flood", date: "2026-07-02" })]);
  assertEquals(r.days[1].rain, 122);
  assertEquals(r.warnings, [
    "Flood on 2026-07-02: soil saturated, do not irrigate until it drains.",
  ]);
});

Deno.test("drought", () => {
  const r = applyScenario(days, [], [ev({ type: "drought", date: "2026-07-01", days: 3 })]);
  for (let i = 0; i < 3; i++) {
    assertEquals(r.days[i].et0, 6.5);
    assertEquals(r.days[i].rain, 0);
  }
  assertEquals(r.days[3], days[3]);
});

Deno.test("frost, hail, irrigation, ignored", () => {
  const irr = [{ date: "2026-06-30", mm: 10 }];
  const r = applyScenario(days, irr, [
    ev({ type: "frost", date: "2026-07-03" }),
    ev({ type: "hail", date: "2026-07-04" }),
    ev({ type: "irrigation", date: "2026-07-02", mm: 20 }),
    ev({ type: "rain", date: "2027-01-01", mm: 5 }),
  ]);
  assertEquals(r.days[2].tmin, -3);
  assertEquals(r.irrigations, [{ date: "2026-06-30", mm: 10 }, { date: "2026-07-02", mm: 20 }]);
  assertEquals(irr.length, 1);
  assertEquals(r.warnings, [
    "Hail on 2026-07-04: check crop damage; this advice assumes an undamaged crop.",
    "Ignored rain on 2027-01-01: no weather data for that date.",
  ]);
});

Deno.test("compareReports", () => {
  const a = { decision: "irrigate_today", irrigateMm: 90 } as never;
  const b = { decision: "wait_for_rain", irrigateMm: 0 } as never;
  const c = compareReports(a, b);
  assertEquals(c.decisionChanged, true);
  assertEquals(c.mmBefore, 90);
  assertEquals(c.mmAfter, 0);
  assertEquals(
    c.summary,
    "Scenario changes the decision from irrigate_today (90 mm) to wait_for_rain (0 mm).",
  );
  const d = compareReports(a, { decision: "irrigate_today", irrigateMm: 70 } as never);
  assertEquals(d.summary, "Scenario keeps irrigate_today; irrigation 90 mm → 70 mm.");
});
