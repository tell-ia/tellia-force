import { describe, expect, it } from "vitest";
import { wheelScrollsX } from "./useWheelScrollX";

const row = (scrollLeft = 0) => ({ scrollWidth: 900, clientWidth: 400, scrollLeft });

describe("mouse wheel on a sideways row", () => {
  it("a wheel down moves the row right, a wheel up moves it back", () => {
    const el = row();
    expect(wheelScrollsX(el, { deltaX: 0, deltaY: 120 })).toBe(true);
    expect(el.scrollLeft).toBe(120);
    expect(wheelScrollsX(el, { deltaX: 0, deltaY: -100 })).toBe(true);
    expect(el.scrollLeft).toBe(20);
  });

  it("leaves trackpad swipes, rows that fit, and the row's ends to the page", () => {
    expect(wheelScrollsX(row(), { deltaX: 80, deltaY: 10 })).toBe(false);
    expect(wheelScrollsX({ scrollWidth: 300, clientWidth: 400, scrollLeft: 0 }, { deltaX: 0, deltaY: 100 })).toBe(false);
    expect(wheelScrollsX(row(0), { deltaX: 0, deltaY: -100 })).toBe(false);
    expect(wheelScrollsX(row(500), { deltaX: 0, deltaY: 100 })).toBe(false);
  });
});
