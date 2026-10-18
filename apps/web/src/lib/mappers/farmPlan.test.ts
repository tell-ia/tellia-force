import { describe, expect, it } from "vitest";
import { comfortGaps, fieldShareOnDay, firstComfortDay, shareLabel, waterEventsByDay } from "./farmPlan";

const run = (passIndex: number, startHour: number, endHour: number, grossMm = 40) => ({ passIndex, startHour, endHour, grossMm });

describe("a field's water, on the days the gun pumps it", () => {
  it("a two-run pass, one run today and one tomorrow: half the dose on each day", () => {
    // Le Petit Clos on 13 Jul 2022: 11:00→23:36 today, 08:00→20:36 tomorrow.
    expect(waterEventsByDay([run(0, 11, 23.6), run(0, 32, 44.6)], "2022-07-13")).toEqual([
      { date: "2022-07-13", grossMm: 20 },
      { date: "2022-07-14", grossMm: 20 },
    ]);
  });
  it("a run past midnight is split by its hours", () => {
    // One run, 18:00 → 06:00: half its hours each side of midnight.
    expect(waterEventsByDay([run(0, 18, 30)], "2022-07-13")).toEqual([
      { date: "2022-07-13", grossMm: 20 },
      { date: "2022-07-14", grossMm: 20 },
    ]);
  });
  it("one run for the whole field: the full dose that day; passes add up per day", () => {
    expect(waterEventsByDay([run(0, 10, 20), run(1, 58, 68, 30)], "2022-07-13")).toEqual([
      { date: "2022-07-13", grossMm: 40 },
      { date: "2022-07-15", grossMm: 30 },
    ]);
  });
  it("drops slivers under 1 mm (the engine refuses 0 mm) and keeps the first 10 days", () => {
    expect(waterEventsByDay([run(0, 23.9, 35.9)], "2022-07-13")).toEqual([{ date: "2022-07-14", grossMm: 39.7 }]);
    const many = Array.from({ length: 14 }, (_, d) => run(d, d * 24 + 8, d * 24 + 18));
    const events = waterEventsByDay(many, "2022-07-13");
    expect(events).toHaveLength(10);
    expect(events.at(-1)!.date).toBe("2022-07-22");
  });
});

describe("comfort gap per day: the re-simulated reserve, then the projection", () => {
  const day = (d: number, reserveMm: number) => ({ date: `2022-07-${String(13 + d).padStart(2, "0")}`, reserveMm });
  // Le Petit Clos, 1 gun, 13 Jul 2022: climbs, dips the day the gun is elsewhere, back on the 18th.
  const series = [day(-1, 74.5), day(0, 56.3), day(1, 66.7), day(2, 76.5), day(3, 85.5), day(4, 78.6), day(5, 86.8), day(6, 94.3)];

  it("threshold − reserve on each simulated day (past days ignored), 0 once above", () => {
    expect(comfortGaps(series, "2022-07-13", 87, 7, 12.5, 2)).toEqual([31, 20, 11, 2, 8, 0, 0]);
  });
  it("past the simulation: carries on from its last day at the rotation's climb", () => {
    expect(comfortGaps([day(0, 80)], "2022-07-13", 87, 4, 0, 3)).toEqual([7, 4, 1, 0]);
    expect(comfortGaps([day(0, 80)], "2022-07-13", 87, 3, 0, -2)).toEqual([7, 9, 11]); // can't out-run the crop
  });
  it("no simulation at all: the projection from today's gap", () => {
    expect(comfortGaps([], "2022-07-13", 87, 4, 10, 4)).toEqual([6, 2, 0, 0]);
  });
  it("comfort day: the first day that ends above comfort, null if none", () => {
    expect(firstComfortDay([31, 20, 11, 2, 8, 0, 0])).toBe(5);
    expect(firstComfortDay([0, 4])).toBe(0);
    expect(firstComfortDay([7, 9, 11])).toBeNull();
  });
});

// Imported here, beside the tests that use it.
import { continuesNextDay, runLabel } from "./farmPlan";

describe("which run of a pass the gun does on a day", () => {
  const r = (passIndex: number, runIndex: number, startHour: number, endHour: number) => ({ passIndex, runIndex, startHour, endHour, grossMm: 40 });
  // Le Petit Clos, 1 gun: pass 1 = halves on Wed and Thu, pass 2 = halves on Fri and Sat.
  const clos = [r(0, 0, 11, 23.6), r(0, 1, 32, 44.6), r(1, 0, 56, 68.6), r(1, 1, 80, 92.6)];
  // Le Puits: run 1 on Sun daytime, run 2 from Sun 21:00 to Mon 08:30.
  const puits = [r(0, 0, 104.4, 115.9), r(0, 1, 116.9, 128.5)];

  it("1/2 then 2/2 for the halves of one pass; a new pass starts at 1/2 again", () => {
    expect([0, 1, 2, 3].map((d) => runLabel(clos, d))).toEqual(["1/2", "2/2", "1/2", "2/2"]);
    expect(runLabel(clos, 4)).toBeNull();
  });
  it("two runs of a pass on one day read 1–2/2; a one-run pass has no label", () => {
    expect(runLabel(puits, 4)).toBe("1–2/2");
    expect(runLabel(puits, 5)).toBe("2/2");
    expect(runLabel([r(0, 0, 10, 20)], 0)).toBeNull();
  });
  it("a pass that carries on into the next day is joined to it, a new pass is not", () => {
    expect([0, 1, 2, 3].map((d) => continuesNextDay(clos, d))).toEqual([true, false, true, false]);
    expect(continuesNextDay(puits, 4)).toBe(true);
    expect(continuesNextDay(puits, 5)).toBe(false);
  });
});

describe("share of the field the gun waters on a day", () => {
  const r = (passIndex: number, startHour: number, endHour: number) => ({ passIndex, startHour, endHour, grossMm: 40 });
  it("half a two-run field today, the other half tomorrow", () => {
    const runs = [r(0, 11, 23.6), r(0, 32, 44.6)];
    expect(fieldShareOnDay(runs, 0)).toBeCloseTo(0.5);
    expect(fieldShareOnDay(runs, 1)).toBeCloseTo(0.5);
    expect(fieldShareOnDay(runs, 2)).toBe(0);
  });
  it("labels: none for the whole field, else the nearest simple fraction (fits a cell)", () => {
    expect(shareLabel(1)).toBeNull();
    expect(shareLabel(0.9)).toBeNull();
    expect(shareLabel(0.5)).toBe("½");
    expect(shareLabel(1 / 3)).toBe("⅓");
    expect(shareLabel(0.63)).toBe("⅔"); // a run that goes past midnight
    expect(shareLabel(0.75)).toBe("¾");
    expect(shareLabel(0.05)).toBe("<¼");
  });
});
