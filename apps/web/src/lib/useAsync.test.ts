import { describe, expect, it } from "vitest";
import { failedLoad, type AsyncState } from "./useAsync";

describe("useAsync: a failed load", () => {
  const loaded: AsyncState<{ id: number }> = { data: { id: 10 }, loading: true, error: null };

  it("by default clears the data and keeps the error", () => {
    expect(failedLoad(loaded, "HTTP 500", false)).toEqual({ data: null, loading: false, error: "HTTP 500" });
  });

  it("keepDataOnError: a failed reload keeps the last data next to the error (the screen stays)", () => {
    expect(failedLoad(loaded, "HTTP 500", true)).toEqual({ data: { id: 10 }, loading: false, error: "HTTP 500" });
    expect(failedLoad({ data: null, loading: true, error: null }, "HTTP 500", true).data).toBeNull();
  });
});
