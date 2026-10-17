import { describe, expect, it } from "vitest";
import { refocusRow, rowDelete, rowDeleteIdle, rowDeleteStatus, rowDeleteView, withoutDeleted, type RowDeleteAction, type RowDeleteState } from "./rowDelete";

const run = (...actions: RowDeleteAction[]): RowDeleteState => actions.reduce(rowDelete, rowDeleteIdle);

describe("row delete (irrigation log)", () => {
  it("every row starts idle: trash shown, no error", () => {
    expect(rowDeleteView(rowDeleteIdle, 7)).toEqual({ mode: "idle", error: null, locked: false });
  });

  it("the trash opens the confirm on that row only", () => {
    const s = run({ type: "ask", id: 7 });
    expect(rowDeleteView(s, 7).mode).toBe("confirming");
    expect(rowDeleteView(s, 8).mode).toBe("idle");
  });

  it("Cancel puts the row back", () => {
    const s = run({ type: "ask", id: 7 }, { type: "cancel" });
    expect(s).toEqual({ step: "idle", back: 7 });
    expect(rowDeleteView(s, 7)).toEqual({ mode: "idle", error: null, locked: false });
  });

  it("only one row confirms at a time: another trash moves the confirm", () => {
    const s = run({ type: "ask", id: 7 }, { type: "ask", id: 8 });
    expect(rowDeleteView(s, 7).mode).toBe("idle");
    expect(rowDeleteView(s, 8).mode).toBe("confirming");
  });

  it("Delete: the row is deleting, the other rows wait", () => {
    const s = run({ type: "ask", id: 7 }, { type: "confirm" });
    expect(rowDeleteView(s, 7)).toEqual({ mode: "deleting", error: null, locked: false });
    expect(rowDeleteView(s, 8)).toEqual({ mode: "idle", error: null, locked: true });
    // While it deletes, other taps change nothing.
    expect(rowDelete(s, { type: "ask", id: 8 })).toBe(s);
    expect(rowDelete(s, { type: "cancel" })).toBe(s);
  });

  it("success: the row is hidden while the list reloads", () => {
    const s = run({ type: "ask", id: 7 }, { type: "confirm" }, { type: "done" });
    const rows = [{ operationId: 8 }, { operationId: 7 }, { operationId: 6 }];
    expect(withoutDeleted(rows, s).map((r) => r.operationId)).toEqual([8, 6]);
    expect(rowDeleteView(s, 8).locked).toBe(false);
    // Nothing hidden in the other states.
    expect(withoutDeleted(rows, run({ type: "ask", id: 7 }, { type: "confirm" }))).toHaveLength(3);
  });

  it("error: the row is back to normal with the message, and the user can retry", () => {
    const failed = run({ type: "ask", id: 7 }, { type: "confirm" }, { type: "failed", message: "HTTP 404" });
    expect(rowDeleteView(failed, 7)).toEqual({ mode: "idle", error: "HTTP 404", locked: false });
    expect(rowDeleteView(failed, 8)).toEqual({ mode: "idle", error: null, locked: false });
    const retry = rowDelete(failed, { type: "ask", id: 7 });
    expect(rowDeleteView(retry, 7)).toEqual({ mode: "confirming", error: null, locked: false });
    expect(rowDeleteView(rowDelete(retry, { type: "confirm" }), 7).mode).toBe("deleting");
  });

  it("paused (the screen saves or undoes): no delete can start, on any row", () => {
    expect(rowDeleteView(rowDeleteIdle, 7, true)).toEqual({ mode: "idle", error: null, locked: true });
    const confirming = run({ type: "ask", id: 7 });
    expect(rowDeleteView(confirming, 7, true)).toEqual({ mode: "confirming", error: null, locked: true });
    expect(rowDeleteView(confirming, 7, false).locked).toBe(false);
  });

  it("focus comes back to a trash: the same row after Cancel or an error, a neighbour after a delete", () => {
    const ids = [8, 7, 6];
    expect(refocusRow(run({ type: "ask", id: 7 }, { type: "cancel" }), ids)).toBe(7);
    expect(refocusRow(run({ type: "ask", id: 7 }, { type: "confirm" }, { type: "failed", message: "x" }), ids)).toBe(7);
    const deleted = (id: number) => run({ type: "ask", id }, { type: "confirm" }, { type: "done" });
    expect(refocusRow(deleted(7), ids)).toBe(6); // the next row
    expect(refocusRow(deleted(6), ids)).toBe(7); // the last row: the one before
    expect(refocusRow(deleted(7), [7])).toBeNull(); // nothing left
    expect(refocusRow(deleted(7), [8, 6])).toBeNull(); // the list already reloaded
    // Nothing to give back while a row is open or at rest.
    expect(refocusRow(rowDeleteIdle, ids)).toBeNull();
    expect(refocusRow(run({ type: "ask", id: 7 }), ids)).toBeNull();
    expect(refocusRow(run({ type: "ask", id: 7 }, { type: "confirm" }), ids)).toBeNull();
    // Another trash after Cancel: that row's Cancel takes the focus, not the cancelled row.
    expect(refocusRow(run({ type: "ask", id: 7 }, { type: "cancel" }, { type: "ask", id: 8 }), ids)).toBeNull();
  });

  it("a screen reader hears when the watering is deleted", () => {
    expect(rowDeleteStatus(run({ type: "ask", id: 7 }, { type: "confirm" }, { type: "done" }))).toBe("Watering deleted.");
    expect(rowDeleteStatus(run({ type: "ask", id: 7 }, { type: "confirm" }))).toBe("");
    expect(rowDeleteStatus(rowDeleteIdle)).toBe("");
  });

  it("Delete, done and failed do nothing unless a row is in the right step", () => {
    expect(rowDelete(rowDeleteIdle, { type: "confirm" })).toBe(rowDeleteIdle);
    expect(rowDelete(rowDeleteIdle, { type: "done" })).toBe(rowDeleteIdle);
    expect(rowDelete(rowDeleteIdle, { type: "failed", message: "x" })).toBe(rowDeleteIdle);
    const confirming = run({ type: "ask", id: 7 });
    expect(rowDelete(confirming, { type: "done" })).toBe(confirming);
  });
});
