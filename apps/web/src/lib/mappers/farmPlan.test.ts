import { describe, expect, it } from "vitest";
import { waterEventsByDay } from "./farmPlan";

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
