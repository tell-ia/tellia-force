import { useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { formatDay } from "../../lib/dates";
import { daysIn, isoOf, mondayOffset, monthInRange, shiftMonth } from "../../features/date/calendar";
import { radius, v } from "../../theme/tokens";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/**
 * A classic date field: shows the day; a tap opens a small month calendar under it.
 * Days outside [min, max] can't be picked. Tapping outside closes it.
 */
export function DateField({ value, min, max, today, disabled = false, ariaLabel, onChange }: {
  value: string;
  min: string;
  max: string;
  /** Shows a "Today" button in the popup when it can be picked. */
  today?: string;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (day: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        aria-label={`${ariaLabel}: ${formatDay(value)}`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 44, padding: "0 12px", borderRadius: 12, border: `1px solid ${open ? v("brand") : v("line")}`, background: v("surface"), color: v("ink"), fontSize: 15, fontWeight: 600, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1 }}
      >
        {formatDay(value)}
        <Calendar size={16} color={v("ink2")} aria-hidden="true" />
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close the calendar" onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 29, border: 0, padding: 0, background: "transparent", cursor: "default" }} />
          <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 30, width: "min(320px, calc(100vw - 32px))", background: v("surface"), border: `1px solid ${v("line")}`, borderRadius: radius.card, boxShadow: "0 8px 24px rgba(15, 24, 19, 0.18)", padding: 12 }}>
            <MonthCalendar
              value={value}
              min={min}
              max={max}
              today={today}
              onPick={(day) => {
                onChange(day);
                setOpen(false);
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

/** The popup's month grid (Monday first), starting on the month of `value`. */
export function MonthCalendar({ value, min, max, today, onPick }: { value: string; min: string; max: string; today?: string; onPick: (day: string) => void }) {
  const [cursor, setCursor] = useState({ year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) - 1 });
  const prev = shiftMonth(cursor.year, cursor.month, -1);
  const next = shiftMonth(cursor.year, cursor.month, 1);
  const canPrev = monthInRange(prev.year, prev.month, min, max);
  const canNext = monthInRange(next.year, next.month, min, max);
  const arrow = (enabled: boolean) => ({ width: 40, height: 40, borderRadius: 20, border: 0, background: "transparent", color: v("ink"), display: "flex", alignItems: "center", justifyContent: "center", cursor: enabled ? "pointer" : "default", opacity: enabled ? 1 : 0.3 });

  const cells = [];
  for (let i = 0; i < mondayOffset(cursor.year, cursor.month); i++) cells.push(<span key={`b${i}`} />);
  for (let d = 1; d <= daysIn(cursor.year, cursor.month); d++) {
    const day = isoOf(cursor.year, cursor.month, d);
    const ok = day >= min && day <= max;
    const on = day === value;
    cells.push(
      <button key={day} type="button" disabled={!ok} aria-pressed={on} aria-label={formatDay(day)} onClick={() => onPick(day)} style={{ height: 40, borderRadius: 20, border: 0, fontSize: 14, fontWeight: on ? 700 : 500, fontVariantNumeric: "tabular-nums", cursor: ok ? "pointer" : "default", background: on ? v("brand") : "transparent", color: on ? v("bg") : ok ? v("ink") : v("ink2"), opacity: ok ? 1 : 0.35 }}>
        {d}
      </button>,
    );
  }

  return (
    <div role="dialog" aria-label="Pick a day" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button type="button" aria-label="Previous month" disabled={!canPrev} onClick={() => setCursor(prev)} style={arrow(canPrev)}><ChevronLeft size={18} /></button>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{MONTHS[cursor.month]} {cursor.year}</span>
        <button type="button" aria-label="Next month" disabled={!canNext} onClick={() => setCursor(next)} style={arrow(canNext)}><ChevronRight size={18} /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 2, textAlign: "center", fontSize: 11, fontWeight: 600, color: v("ink2") }}>
        {WEEK.map((w) => <span key={w}>{w}</span>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 2 }}>{cells}</div>
      {today && today >= min && today <= max && (
        <button type="button" onClick={() => onPick(today)} style={{ alignSelf: "flex-end", height: 40, padding: "0 12px", borderRadius: 20, border: 0, background: "transparent", color: v("brand"), fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
          Today
        </button>
      )}
    </div>
  );
}
