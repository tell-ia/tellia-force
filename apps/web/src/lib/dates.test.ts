import { describe, expect, it } from "vitest";
import { addDays, dayRange, formatDay, localToday } from "./dates";

describe("dates", () => {
  it("formats a day with and without the year", () => {
    expect(formatDay("2026-07-15")).toBe("Wed 15 Jul 2026");
    expect(formatDay("2022-07-13", { year: false })).toBe("Wed 13 Jul");
  });

  it("adds days across months and years", () => {
    expect(addDays("2026-07-15", -4)).toBe("2026-07-11");
    expect(addDays("2026-08-02", -4)).toBe("2026-07-29");
    expect(addDays("2025-12-30", 3)).toBe("2026-01-02");
  });

  it("writes a day range in one or two months", () => {
    expect(dayRange("2026-07-05", "2026-07-20")).toBe("5–20 Jul");
    expect(dayRange("2026-07-28", "2026-08-08")).toBe("28 Jul–8 Aug");
  });

  it("gives the device date as YYYY-MM-DD", () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});
