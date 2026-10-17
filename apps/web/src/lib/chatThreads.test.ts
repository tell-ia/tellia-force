import { describe, expect, it } from "vitest";
import { FALLBACK_THREAD_TITLE, threadDateLabel, threadLabel } from "./chatThreads";

// Local-time constructors: the helpers work in the device's time zone.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const iso = (d: Date) => d.toISOString();

describe("threadLabel", () => {
  it("keeps a real generated title, trimmed", () => {
    expect(threadLabel("  Irrigation of La Vallée ")).toBe("Irrigation of La Vallée");
    expect(threadLabel("Chat about the rain")).toBe("Chat about the rain");
  });

  it("falls back when the title is missing, empty or a placeholder", () => {
    for (const t of [null, undefined, "", "   ", "New Thread", "New Thread 2026-07-05", "new chat", "Untitled", "Chat"]) {
      expect(threadLabel(t)).toBe(FALLBACK_THREAD_TITLE);
    }
  });
});

describe("threadDateLabel", () => {
  const now = at(2026, 7, 22, 16, 30);

  it("says Today with the time", () => {
    expect(threadDateLabel(iso(at(2026, 7, 22, 14, 5)), now)).toBe("Today 14:05");
    expect(threadDateLabel(iso(at(2026, 7, 22, 9, 0)), now)).toBe("Today 09:00");
  });

  it("says Yesterday, also across a month start", () => {
    expect(threadDateLabel(iso(at(2026, 7, 21, 23, 59)), now)).toBe("Yesterday");
    expect(threadDateLabel(iso(at(2026, 6, 30)), at(2026, 7, 1))).toBe("Yesterday");
  });

  it("uses the weekday and date for older days, with the year only when it differs", () => {
    expect(threadDateLabel(iso(at(2026, 7, 21 - 1)), now)).toBe("Mon 20 Jul");
    expect(threadDateLabel(iso(at(2025, 12, 31)), now)).toBe("Wed 31 Dec 2025");
  });

  it("is empty for an unreadable timestamp", () => {
    expect(threadDateLabel("nope", now)).toBe("");
  });
});
