import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useDemoDate } from "../app/DateContext";
import { formatDay } from "../lib/dates";
import { font, radius, v } from "../theme/tokens";

/** Demo days with a clear weather story (Loiret, farm 1; June–August rain from weather_daily). */
export const DATE_PRESETS = [
  { date: "2026-07-15", title: "Very dry summer", sub: "Loiret 2026: 79 mm of rain from June to August" },
  { date: "2022-07-13", title: "Drought and heat wave", sub: "Loiret 2022: 11 mm of rain in July" },
  { date: "2021-07-15", title: "Wet summer", sub: "Loiret 2021: 211 mm of rain from June to August" },
] as const;

/** The date chip as a button: shows the project's "today" and opens the demo date sheet. */
export function DateButton({ year = true }: { year?: boolean }) {
  const { today, state } = useDemoDate();
  const [open, setOpen] = useState(false);
  const demo = state?.demoDate != null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Date: ${formatDay(today)}. Change the demo date`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          minHeight: 32,
          border: 0,
          cursor: "pointer",
          fontSize: 12,
          fontWeight: demo ? 600 : 500,
          color: demo ? v("ink") : v("ink2"),
          background: demo ? v("waterSoft") : v("sunk"),
          borderRadius: radius.chip,
          padding: "5px 11px",
          whiteSpace: "nowrap",
        }}
      >
        {formatDay(today, { year })}
        <ChevronDown size={13} />
      </button>
      {open && <DateSheet onClose={() => setOpen(false)} />}
    </>
  );
}

export function DateSheet({ onClose }: { onClose: () => void }) {
  const { today, state, setDate } = useDemoDate();
  const [picked, setPicked] = useState(today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (date: string | null) => {
    setSaving(true);
    setError(null);
    try {
      await setDate(date);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", zIndex: 10 }}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{ position: "absolute", inset: 0, border: 0, padding: 0, background: "rgba(15, 24, 19, 0.48)", cursor: "pointer" }}
      />
      <div
        role="dialog"
        aria-label="Demo date"
        style={{
          position: "relative",
          background: v("bg"),
          borderRadius: "22px 22px 0 0",
          padding: "10px 20px calc(28px + env(safe-area-inset-bottom))",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, background: v("line") }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontFamily: font.display, fontWeight: 600, fontSize: 28, lineHeight: 1 }}>Demo date</div>
          <div style={{ fontSize: 13, color: v("ink2") }}>
            The app, the chat, calls and texts all use this day as today.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="date"
            aria-label="Pick a day"
            value={picked}
            min={state?.min}
            max={state?.max}
            onChange={(e) => setPicked(e.target.value)}
            style={{ flex: 1, minWidth: 0, height: 48, borderRadius: 12, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), fontSize: 15, padding: "0 12px" }}
          />
          <button
            type="button"
            disabled={saving || !picked || !state}
            onClick={() => void choose(picked)}
            style={{ height: 48, border: 0, borderRadius: 12, padding: "0 16px", fontSize: 15, fontWeight: 600, cursor: "pointer", background: v("brand"), color: v("bg"), opacity: saving || !state ? 0.5 : 1 }}
          >
            Use
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {DATE_PRESETS.map((p) => (
            <Option key={p.date} title={p.title} sub={`${formatDay(p.date)} · ${p.sub}`} selected={today === p.date} disabled={saving || !state} onPick={() => void choose(p.date)} />
          ))}
          <Option
            title="Real date"
            sub={state ? formatDay(state.realToday) : "Unknown: the API is not reachable"}
            selected={state != null && state.demoDate === null}
            disabled={saving || !state}
            onPick={() => void choose(null)}
          />
        </div>

        {!state && <div style={{ fontSize: 13, color: v("act") }}>Can't reach the API, so the date can't change.</div>}
        {error && <div style={{ fontSize: 13, color: v("act") }}>{error}</div>}
      </div>
    </div>
  );
}

function Option({ title, sub, selected, disabled, onPick }: { title: string; sub: string; selected: boolean; disabled: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-pressed={selected}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        width: "100%",
        boxSizing: "border-box",
        textAlign: "left",
        color: v("ink"),
        cursor: "pointer",
        borderRadius: 14,
        padding: "10px 14px",
        background: v("surface"),
        border: selected ? `2px solid ${v("brand")}` : `1px solid ${v("line")}`,
        opacity: disabled && !selected ? 0.6 : 1,
      }}
    >
      <span style={{ fontWeight: 600, fontSize: 15 }}>{title}</span>
      <span style={{ fontSize: 12, color: v("ink2") }}>{sub}</span>
    </button>
  );
}
