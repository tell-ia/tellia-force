// plan_irrigation with a p that changes every day (FAO-56 eq. 5): the planned date must not
// slide or vanish the next morning.
import { assertEquals } from "@std/assert";
import { buildFieldReport, type ReportInput } from "../src/modules/irrigation/engine/report";
import { addDays } from "../src/modules/irrigation/engine/util";

/** TAW 100, pTable 0.55, kc 1, no rain, from 2026-07-06. ET0 5 unless `et0` says otherwise. */
function input(asOf: string, start: number, et0: Record<string, number>): ReportInput {
  const days = Array.from({ length: 14 }, (_, i) => {
    const date = addDays("2026-07-06", i);
    return {
      date,
      et0: et0[date] ?? 5,
      rain: 0,
      tmin: 12,
      kc: 1,
      taw: 100,
      pTable: 0.55,
      pCap: null,
    };
  });
  return {
    field: { id: 10, name: "La Vallée", irrigable: true },
    season: { cropCode: "MAIZ" },
    cropName: "Maïs grain",
    days,
    irrigations: [],
    taw: 100,
    p: 0.55,
    asOf,
    stageLabel: null,
    startDepletion: start,
    system: { efficiency: 1, doseMaxMm: null, roundDays: 3 },
  };
}

Deno.test("plan date: a low RAW today does not plan a watering the next morning drops", () => {
  // 07-08: ET0 8 → p 0.43, RAW 43, ends at D 46. 07-09: ET0 2 → RAW 67, so no stress on 07-09.
  const et0 = { "2026-07-08": 8, "2026-07-09": 2, "2026-07-10": 2, "2026-07-11": 2 };
  for (const asOf of ["2026-07-07", "2026-07-08", "2026-07-09"]) {
    const r = buildFieldReport(input(asOf, 28, et0));
    assertEquals(r.decision, "no_irrigation", asOf);
    assertEquals(r.irrigateBy, null, asOf);
  }
});

Deno.test("plan date: the date holds until the irrigate_today morning", () => {
  // 07-10: ET0 9 → p 0.39, RAW 39. D ends 07-09 at 40 ≥ 39: stress from the morning of 07-10.
  const et0 = { "2026-07-10": 9 };
  for (const asOf of ["2026-07-08", "2026-07-09"]) {
    const r = buildFieldReport(input(asOf, 20, et0));
    assertEquals(r.decision, "plan_irrigation", asOf);
    assertEquals(r.irrigateBy, "2026-07-10", asOf);
  }
  const today = buildFieldReport(input("2026-07-10", 20, et0));
  assertEquals(today.decision, "irrigate_today");
  assertEquals(today.irrigateBy, "2026-07-10");
});
