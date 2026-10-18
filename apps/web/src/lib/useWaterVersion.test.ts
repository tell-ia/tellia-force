import { describe, expect, it } from "vitest";
import { invalidateQueries, onInvalidate } from "./api/cache";
import { WATER_KEYS } from "./api/irrigation";

// useWaterVersion bumps when an invalidation touches WATER_KEYS: what it listens for.
describe("water changes reach the farm plan", () => {
  const touchesWater = (prefixes: string[]) => {
    let hit = false;
    const stop = onInvalidate((changed) => {
      hit = WATER_KEYS.some((k) => changed(k));
    });
    invalidateQueries(prefixes);
    stop();
    return hit;
  };

  it("a logged, corrected or deleted watering (the advice and the reports are dropped)", () => {
    expect(touchesWater(WATER_KEYS)).toBe(true);
    expect(touchesWater(["parcel:"])).toBe(true);
  });
  it("not an unrelated write", () => {
    expect(touchesWater(["chatThreads:"])).toBe(false);
  });
});
