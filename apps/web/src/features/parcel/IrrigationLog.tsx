import { useReducer, useState } from "react";
import { Droplet, Trash2 } from "lucide-react";
import type { IrrigationRecord } from "@tellia/shared";
import { formatDay } from "../../lib/dates";
import { rowDelete, rowDeleteIdle, rowDeleteView, withoutDeleted, type RowDeleteView } from "../../lib/rowDelete";
import { radius, space, v } from "../../theme/tokens";
import { Label } from "../../components/ui/primitives";

const FIRST = 5;

/**
 * The field's saved irrigations, newest first (the API sorts them and stops at today): logged in
 * the app, told to the chat or the phone, or imported with the farm. `mm` is what was pumped.
 */
export function IrrigationLog({ records, loading, error, onLog, highlightId, onDelete, disabled = false }: {
  records: IrrigationRecord[] | null;
  loading: boolean;
  error: string | null;
  /** The "Log watering" button; left out on the Log screen itself. */
  onLog?: () => void;
  /** A row to highlight (the watering just saved). */
  highlightId?: number;
  /** Delete a watering: a trash per row, with an inline confirm. The parent reloads after it. */
  onDelete?: (operationId: number) => Promise<void>;
  /** The parent runs another change (a save, an undo): no delete can start meanwhile. */
  disabled?: boolean;
}) {
  const [all, setAll] = useState(false);
  const [del, dispatch] = useReducer(rowDelete, rowDeleteIdle);
  const list = withoutDeleted(records ?? [], del);
  const shown = all ? list : list.slice(0, FIRST);
  const remove = async (operationId: number) => {
    if (!onDelete || disabled) return;
    dispatch({ type: "confirm" });
    try {
      await onDelete(operationId);
      dispatch({ type: "done" });
    } catch (e) {
      dispatch({ type: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Label>Irrigation log</Label>
        {list.length > 0 && <span style={{ fontSize: 12, color: v("ink2") }}>{list.length} {list.length === 1 ? "watering" : "waterings"}</span>}
      </div>
      {loading && <div style={{ fontSize: 13, color: v("ink2") }}>Loading the log…</div>}
      {error && <div role="alert" style={{ fontSize: 13, color: v("act") }}>Couldn't load the log: {error}</div>}
      {!loading && !error && list.length === 0 && (
        <div style={{ fontSize: 13, color: v("ink2") }}>No watering logged on this field yet.</div>
      )}
      {shown.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
          {shown.map((r) => (
            <LogRow
              key={r.operationId}
              record={r}
              highlighted={r.operationId === highlightId}
              view={rowDeleteView(del, r.operationId, disabled)}
              canDelete={!!onDelete}
              onAsk={() => dispatch({ type: "ask", id: r.operationId })}
              onCancel={() => dispatch({ type: "cancel" })}
              onConfirm={() => void remove(r.operationId)}
            />
          ))}
        </ul>
      )}
      {list.length > FIRST && (
        <button type="button" onClick={() => setAll((a) => !a)} style={{ alignSelf: "flex-start", minHeight: 44, border: 0, background: "transparent", color: v("brand"), fontWeight: 600, fontSize: 14, padding: 0, cursor: "pointer" }}>
          {all ? "Show less" : `Show all (${list.length})`}
        </button>
      )}
      {onLog && (
        <button type="button" onClick={onLog} style={{ height: 50, borderRadius: radius.card, border: 0, background: v("brand"), color: v("bg"), fontWeight: 600, fontSize: 15, cursor: "pointer" }}>
          Log watering
        </button>
      )}
    </>
  );
}

/** One watering: its day and mm; with delete, a trash that turns into an inline confirm. */
export function LogRow({ record, highlighted, view, canDelete, onAsk, onCancel, onConfirm }: {
  record: IrrigationRecord;
  highlighted: boolean;
  view: RowDeleteView;
  canDelete: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const day = formatDay(record.date);
  const busy = view.mode === "deleting";
  const confirmBtn = (off: boolean) => ({ height: 44, flex: "none", padding: `0 ${space.md}px`, borderRadius: radius.pill, fontWeight: 600, fontSize: 14, cursor: off ? "default" : "pointer", opacity: off ? 0.55 : 1 }) as const;
  return (
    <li aria-current={highlighted || undefined} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: space.xs, minHeight: 44, borderBottom: `1px solid ${v("line")}`, ...(highlighted ? { background: v("okSoft"), margin: "0 -8px", padding: "0 8px", borderRadius: radius.tile } : {}) }}>
      <Droplet size={16} color={v("water")} aria-hidden="true" />
      <span style={{ flex: 1, fontSize: 14, lineHeight: "44px", whiteSpace: "nowrap" }}>{day}</span>
      <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{record.mm} mm</span>
      {canDelete && view.mode === "idle" && (
        <button type="button" aria-label={`Delete the watering of ${day}`} disabled={view.locked} onClick={onAsk} style={{ width: 44, height: 44, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", border: 0, borderRadius: radius.pill, background: "transparent", color: v("ink2"), cursor: view.locked ? "default" : "pointer", opacity: view.locked ? 0.4 : 1 }}>
          <Trash2 size={18} aria-hidden="true" />
        </button>
      )}
      {canDelete && view.mode !== "idle" && (
        <span style={{ marginLeft: "auto", marginBottom: space.xs, display: "flex", alignItems: "center", gap: space.sm }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{busy ? "Deleting…" : "Delete?"}</span>
          <button type="button" disabled={busy || view.locked} onClick={onConfirm} style={{ ...confirmBtn(busy || view.locked), border: 0, background: v("act"), color: v("bg") }}>Delete</button>
          <button type="button" disabled={busy} onClick={onCancel} autoFocus style={{ ...confirmBtn(busy), border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink") }}>Cancel</button>
        </span>
      )}
      {view.error && (
        <div role="alert" style={{ flexBasis: "100%", fontSize: 13, color: v("act"), paddingBottom: space.sm }}>Couldn't delete: {view.error}</div>
      )}
    </li>
  );
}
