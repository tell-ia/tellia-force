import { assertAlmostEquals, assertEquals } from "@std/assert";
import { runWaterBalance, type WeatherInput } from "../src/modules/irrigation/engine/waterBalance";
import { addDays } from "../src/modules/irrigation/engine/util";

// ETc = 5 mm/day unless a day says otherwise.
function days(n: number, over: Record<number, Partial<WeatherInput>> = {}): WeatherInput[] {
  return Array.from({ length: n }, (_, i) => ({
    date: addDays("2026-07-01", i),
    et0: 5,
    rain: 0,
    tmin: 12,
    kc: 1,
    ...over[i],
  }));
}

Deno.test("balance: irrigation counts gross × efficiency", () => {
  const r = runWaterBalance({
    days: days(3),
    irrigations: [{ date: "2026-07-02", mm: 40 }],
    taw: 100,
    p: 0.55,
    startDepletion: 40,
    efficiency: 0.75,
  });
  // day 1: 40 + 5 = 45; day 2: 45 − 30 + 5 = 20; day 3: 25
  assertEquals(r.map((d) => d.depletion), [45, 20, 25]);
  assertEquals(r[1].irrigation, 30); // net, what reached the roots
});

Deno.test("balance: without efficiency the pumped water counts in full (old behaviour)", () => {
  const r = runWaterBalance({
    days: days(2),
    irrigations: [{ date: "2026-07-02", mm: 30 }],
    taw: 100,
    p: 0.55,
    startDepletion: 40,
  });
  assertEquals(r.map((d) => d.depletion), [45, 20]);
});

Deno.test("balance: water above field capacity is reported as drainage", () => {
  const r = runWaterBalance({
    days: days(3, { 1: { rain: 50 } }),
    irrigations: [],
    taw: 100,
    p: 0.55,
  });
  // day 1: 5; day 2: 5 − 50 + 5 = −40 → depletion 0, drainage 40
  assertEquals(r.map((d) => d.depletion), [5, 0, 5]);
  assertEquals(r.map((d) => d.drainage), [0, 40, 0]);
});

Deno.test("balance: over-irrigation shows up as drainage", () => {
  const r = runWaterBalance({
    days: days(2),
    irrigations: [{ date: "2026-07-02", mm: 40 }],
    taw: 100,
    p: 0.55,
    startDepletion: 10,
    efficiency: 0.75,
  });
  // day 2: 15 − 30 + 5 = −10 → drainage 10
  assertEquals(r[1].depletion, 0);
  assertEquals(r[1].drainage, 10);
});

Deno.test("balance: rain counts in full, even small showers", () => {
  const r = runWaterBalance({
    days: days(2, { 1: { rain: 3 } }),
    irrigations: [],
    taw: 100,
    p: 0.55,
    startDepletion: 20,
  });
  assertEquals(r.map((d) => d.depletion), [25, 27]);
});

Deno.test("balance: start depletion is the soil state before the first day", () => {
  const r = runWaterBalance({ days: days(1), irrigations: [], taw: 100, p: 0.55, startDepletion: 30 });
  assertEquals(r[0].depletion, 35);
});

Deno.test("balance: daily TAW from root growth, depletion kept in mm", () => {
  const r = runWaterBalance({
    days: days(3, { 0: { taw: 24 }, 1: { taw: 30 }, 2: { taw: 36 } }),
    irrigations: [],
    taw: 100,
    p: 0.55,
    startDepletion: 10,
  });
  assertEquals(r.map((d) => d.taw), [24, 30, 36]);
  assertEquals(r.map((d) => d.depletion), [15, 20, 25]); // not rescaled when roots grow
});

Deno.test("balance: daily p from eq. 5 and the sensitive cap; RAW = p × TAW of the day", () => {
  const r = runWaterBalance({
    days: days(3, {
      0: { taw: 100, pTable: 0.55 }, // ETc 5 → p 0.55
      1: { taw: 100, pTable: 0.55, et0: 7 }, // ETc 7 → p 0.47
      2: { taw: 100, pTable: 0.55, et0: 7, pCap: 0.45 }, // capped at 0.45
    }),
    irrigations: [],
    taw: 100,
    p: 0.6,
  });
  assertAlmostEquals(r[0].p, 0.55, 1e-9);
  assertAlmostEquals(r[1].p, 0.47, 1e-9);
  assertAlmostEquals(r[2].p, 0.45, 1e-9);
  assertAlmostEquals(r[2].raw, 45, 1e-9);
});

Deno.test("balance: Ks uses the day's RAW", () => {
  const r = runWaterBalance({
    days: days(1, { 0: { taw: 100, pTable: 0.5 } }), // ETc 5 → p 0.5 → RAW 50
    irrigations: [],
    taw: 100,
    p: 0.55,
    startDepletion: 75,
  });
  assertAlmostEquals(r[0].ks, 0.5, 1e-9); // (100 − 75) / (100 − 50)
  assertAlmostEquals(r[0].depletion, 77.5, 1e-9);
});
