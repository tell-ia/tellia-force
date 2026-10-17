import { useState } from "react";
import { Droplet } from "lucide-react";
import type { IrrigationRecord } from "@tellia/shared";
import { formatDay } from "../../lib/dates";
import { radius, v } from "../../theme/tokens";
import { Label } from "../../components/ui/primitives";

const FIRST = 5;

/**
 * The field's saved irrigations, newest first (the API sorts them and stops at today): logged in
 * the app, told to the chat or the phone, or imported with the farm. `mm` is what was pumped.
 */
export function IrrigationLog({ records, loading, error, onLog, highlightId }: {
  records: IrrigationRecord[] | null;
  loading: boolean;
  error: string | null;
  /** The "Log watering" button; left out on the Log screen itself. */
  onLog?: () => void;
  /** A row to highlight (the watering just saved). */
  highlightId?: number;
}) {
  const [all, setAll] = useState(false);
  const list = records ?? [];
  const shown = all ? list : list.slice(0, FIRST);
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
            <li key={r.operationId} aria-current={r.operationId === highlightId || undefined} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, borderBottom: `1px solid ${v("line")}`, ...(r.operationId === highlightId ? { background: v("okSoft"), margin: "0 -8px", padding: "0 8px", borderRadius: radius.tile } : {}) }}>
              <Droplet size={16} color={v("water")} aria-hidden="true" />
              <span style={{ flex: 1, fontSize: 14 }}>{formatDay(r.date)}</span>
              <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{r.mm} mm</span>
            </li>
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
