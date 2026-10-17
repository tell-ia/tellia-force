import { describe, expect, it } from "vitest";
import { clampDate, daysIn, endOfMonth, isoOf, monthAnchor, monthInRange, shiftMonth, yearAnchor } from "./calendar";

describe("calendar helpers", () => {
  it("builds dates and month ends (leap years included)", () => {
    expect(isoOf(2026, 6, 5)).toBe("2026-07-05");
    expect(daysIn(2024, 1)).toBe(29);
    expect(daysIn(2026, 1)).toBe(28);
    expect(endOfMonth(2021, 6)).toBe("2021-07-31");
  });

  it("moves across years", () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2025, 11, 1)).toEqual({ year: 2026, month: 0 });
    expect(shiftMonth(2026, 6, 0)).toEqual({ year: 2026, month: 6 });
  });

  it("knows which months have pickable days", () => {
    expect(monthInRange(2014, 11, "2015-01-01", "2026-10-17")).toBe(false);
    expect(monthInRange(2015, 0, "2015-01-01", "2026-10-17")).toBe(true);
    expect(monthInRange(2026, 9, "2015-01-01", "2026-10-17")).toBe(true);
    expect(monthInRange(2026, 10, "2015-01-01", "2026-10-17")).toBe(false);
  });

  it("loads soil water no later than the project's today", () => {
    expect(clampDate("2014-06-01", "2015-01-01", "2026-10-17")).toBe("2015-01-01");
    // A past month: its last day.
    expect(monthAnchor(2021, 6, "2015-01-01", "2026-10-17")).toBe("2021-07-31");
    // The month of a demo today: today (the API refuses a report after today + 7).
    expect(monthAnchor(2021, 6, "2015-01-01", "2021-07-15")).toBe("2021-07-15");
    // Another year: its summer; today's year: today.
    expect(yearAnchor(2022, "2015-01-01", "2026-10-17")).toBe("2022-08-31");
    expect(yearAnchor(2026, "2015-01-01", "2026-10-17")).toBe("2026-10-17");
    expect(yearAnchor(2026, "2015-01-01", "2021-07-15")).toBe("2021-07-15");
  });
});
