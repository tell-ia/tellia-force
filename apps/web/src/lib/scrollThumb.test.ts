import { describe, expect, it } from "vitest";
import { scrollLeftForThumb, scrollThumb } from "./scrollThumb";

const row = { client: 400, scroll: 800 };

describe("scrollThumb", () => {
  it("is null when the row fits", () => {
    expect(scrollThumb({ left: 0, client: 400, scroll: 400 })).toBeNull();
  });

  it("is as wide as the visible part, and walks to the end", () => {
    expect(scrollThumb({ ...row, left: 0 })).toEqual({ size: 0.5, start: 0 });
    expect(scrollThumb({ ...row, left: 200 })).toEqual({ size: 0.5, start: 0.25 });
    expect(scrollThumb({ ...row, left: 400 })).toEqual({ size: 0.5, start: 0.5 });
  });

  it("keeps a grabbable minimum width on a long row", () => {
    expect(scrollThumb({ left: 0, client: 100, scroll: 10_000 })?.size).toBe(0.15);
  });

  it("maps a thumb position back to scrollLeft, clamped", () => {
    expect(scrollLeftForThumb({ ...row, left: 0 }, 0.25, 0.5)).toBe(200);
    expect(scrollLeftForThumb({ ...row, left: 0 }, 0.9, 0.5)).toBe(400);
    expect(scrollLeftForThumb({ ...row, left: 0 }, -1, 0.5)).toBe(0);
  });
});
