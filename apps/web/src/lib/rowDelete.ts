// Deleting one row of the irrigation log, with an inline confirm. One row at a time:
// idle → confirming (the trash) → deleting (the Delete button) → deleted (hidden while the list
// reloads), or error (the row is back to normal with a message, so the user can retry).

export type RowDeleteState =
  | { step: "idle"; back?: number } // back: the row just cancelled (its trash takes the focus back)
  | { step: "confirming"; id: number }
  | { step: "deleting"; id: number }
  | { step: "deleted"; id: number }
  | { step: "error"; id: number; message: string };

export type RowDeleteAction =
  | { type: "ask"; id: number } // the trash of a row
  | { type: "cancel" }
  | { type: "confirm" } // the Delete button
  | { type: "done" }
  | { type: "failed"; message: string };

export const rowDeleteIdle: RowDeleteState = { step: "idle" };

/** The reducer. While a row is deleting, other taps change nothing. */
export function rowDelete(state: RowDeleteState, action: RowDeleteAction): RowDeleteState {
  switch (action.type) {
    case "ask":
      return state.step === "deleting" ? state : { step: "confirming", id: action.id };
    case "cancel":
      return state.step === "confirming" ? { step: "idle", back: state.id } : state;
    case "confirm":
      return state.step === "confirming" ? { step: "deleting", id: state.id } : state;
    case "done":
      return state.step === "deleting" ? { step: "deleted", id: state.id } : state;
    case "failed":
      return state.step === "deleting" ? { step: "error", id: state.id, message: action.message } : state;
  }
}

export interface RowDeleteView {
  /** idle: the trash; confirming: "Delete?" + Delete + Cancel; deleting: "Deleting…", buttons off. */
  mode: "idle" | "confirming" | "deleting";
  /** Why the last delete of this row failed (shown under it), or null. */
  error: string | null;
  /** No delete can start on this row now (another row is deleting, or the screen is busy): its
   *  trash and its Delete button wait. */
  locked: boolean;
}

/** What one row shows. `paused`: the screen runs another change (a save, an undo), so no delete
 *  can start until it ends (two changes at once would race). */
export function rowDeleteView(state: RowDeleteState, id: number, paused = false): RowDeleteView {
  const mine = state.step !== "idle" && state.id === id;
  return {
    mode: mine && (state.step === "confirming" || state.step === "deleting") ? state.step : "idle",
    error: mine && state.step === "error" ? state.message : null,
    locked: paused || (state.step === "deleting" && !mine),
  };
}

/**
 * The row whose trash takes the focus back, so a keyboard or screen-reader user keeps their place
 * (the focused Cancel / Delete button is gone): the same row after Cancel or an error; after a
 * delete, the next row, else the one before. `ids`: every row in list order, the deleted one too.
 */
export function refocusRow(state: RowDeleteState, ids: number[]): number | null {
  if (state.step === "idle") return state.back ?? null;
  if (state.step === "error") return state.id;
  if (state.step !== "deleted") return null;
  const i = ids.indexOf(state.id);
  return i < 0 ? null : ids[i + 1] ?? ids[i - 1] ?? null;
}

/** What a screen reader hears (a polite status): the row is gone once deleted. */
export function rowDeleteStatus(state: RowDeleteState): string {
  return state.step === "deleted" ? "Watering deleted." : "";
}

/** The rows to show: the one just deleted is hidden while the list reloads. */
export function withoutDeleted<T extends { operationId: number }>(rows: T[], state: RowDeleteState): T[] {
  return state.step === "deleted" ? rows.filter((r) => r.operationId !== state.id) : rows;
}
