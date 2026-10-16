import { assertEquals } from "@std/assert";
import {
  addDays,
  daysBetween,
  round1,
  round2,
  todayIn,
} from "../src/modules/irrigation/engine/util.ts";

Deno.test("addDays crosses month, year and goes backwards", () => {
  assertEquals(addDays("2026-06-30", 1), "2026-07-01");
  assertEquals(addDays("2026-12-31", 1), "2027-01-01");
  assertEquals(addDays("2026-03-01", -1), "2026-02-28");
});

Deno.test("daysBetween is signed and UTC based", () => {
  assertEquals(daysBetween("2026-04-16", "2026-07-05"), 80);
  assertEquals(daysBetween("2026-07-05", "2026-04-16"), -80);
  assertEquals(daysBetween("2026-03-28", "2026-03-30"), 2); // DST week
});

Deno.test("todayIn honours the time zone", () => {
  const now = new Date("2026-07-04T23:30:00Z");
  assertEquals(todayIn("Europe/Paris", now), "2026-07-05");
  assertEquals(todayIn("UTC", now), "2026-07-04");
});

Deno.test("rounding helpers", () => {
  assertEquals(round1(156.00000000000003), 156);
  assertEquals(round1(1.26), 1.3);
  assertEquals(round2(0.3049), 0.3);
  assertEquals(round2(1.005 + 0.0001), 1.01);
});
