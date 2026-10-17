import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { FarmToday } from "@tellia/shared";
import { getFarmToday, getSeasonHeatmap, mergeHeatDays, type HeatDay } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { useFarm } from "../../app/FarmContext";
import { useDemoDate } from "../../app/DateContext";
import { formatDay } from "../../lib/dates";
import { font, v } from "../../theme/tokens";
import { Loader } from "../../components/ui/Loader";
import { DATE_PRESETS } from "./presets";
import { daysIn, isoOf, monthAnchor, monthInRange, shiftMonth, yearAnchor } from "./calendar";

// Soil-water heatmap scale (fixed, read as a gradient dry→full). Not theme tokens:
// these greens/ambers carry meaning and must stay identical in light & dark.
const RAIN = "#2F5F6A";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function scale(p: number): { bg: string; fg: string } {
  if (p >= 90) return { bg: "#1F6B60", fg: "#F6F3E8" };
  if (p >= 75) return { bg: "#3F9384", fg: "#F6F3E8" };
  if (p >= 55) return { bg: "#A9D3C8", fg: "#182E22" };
  if (p >= 45) return { bg: "#E2B377", fg: "#182E22" };
  return { bg: "#B26A1E", fg: "#F6F3E8" };
}
function status(p: number, fc: boolean): { tag: string; bg: string; fg: string } {
  if (p < 55) return { tag: fc ? "Below threshold · forecast" : "Water stress", bg: "#F4E4CC", fg: "#7A4510" };
  if (p < 75) return { tag: fc ? "Tight · forecast" : "Tight", bg: "#E2EFE6", fg: "#234534" };
  return { tag: fc ? "Comfortable · forecast" : "Comfortable", bg: "#D5E8E3", fg: "#1F4F47" };
}
/** Monday-first offset of the 1st of the month. */
const offsetOf = (year: number, mi: number): number => (new Date(Date.UTC(year, mi, 1)).getUTCDay() + 6) % 7;

export function DatePickerSheet({ onClose }: { onClose: () => void }) {
  const { farm } = useFarm();
  const { today, state, setDate } = useDemoDate();
  // The demo date is global on the server (one "today" for app + chat + VAPI).
  // Any day from the first weather day to the real today can be picked.
  const min = state?.min ?? "2015-01-01";
  const max = state?.max ?? today;
  const todayYear = Number(today.slice(0, 4));
  const todayMonth = Number(today.slice(5, 7)) - 1;

  // The heatmap colors the farm's most urgent field today.
  const { data: todayData, loading: todayLoading } = useAsync<FarmToday | null>(
    () => (farm ? getFarmToday(farm) : Promise.resolve(null)),
    [farm?.id, today],
  );
  const action = todayData?.parcels.find((p) => p.status === "action") ?? todayData?.parcels[0];
  const fieldId = action?.id ?? null;

  const [view, setView] = useState<"year" | "month">("month");
  const [sel, setSel] = useState(today);
  const [cursor, setCursor] = useState({ year: todayYear, month: todayMonth });
  // Soil water is loaded around an anchor day (~3 months per load) and kept as months open.
  const [anchor, setAnchor] = useState(today);
  const [byDate, setByDate] = useState<Record<string, HeatDay>>({});
  const [pending, setPending] = useState(0);
  const loaded = useRef(new Set<string>());
  useEffect(() => {
    const key = `${fieldId}|${anchor}`;
    if (fieldId === null || loaded.current.has(key)) return;
    loaded.current.add(key);
    setPending((n) => n + 1);
    getSeasonHeatmap(fieldId, anchor)
      .then((h) => setByDate((prev) => mergeHeatDays(prev, h.byDate)))
      .catch(() => loaded.current.delete(key))
      .finally(() => setPending((n) => n - 1));
  }, [fieldId, anchor]);

  const openMonth = (year: number, month: number) => {
    setCursor({ year, month });
    setView("month");
    setAnchor(monthAnchor(year, month, min, today));
  };
  const openYear = (year: number) => {
    setCursor((c) => ({ year, month: c.month }));
    setView("year");
    setAnchor(yearAnchor(year, min, today));
  };
  const goToday = () => {
    setSel(today);
    openMonth(todayYear, todayMonth);
  };
  const pick = (date: string | null) => {
    // null = back to the server's default (the real today).
    setDate(date !== null && date === state?.realToday ? null : date).catch(() => {});
    onClose();
  };

  const sv = byDate[sel];
  const selFc = sel > today;
  const selScale = scale(sv?.pct ?? 0);
  const selStatus = status(sv?.pct ?? 0, selFc);
  const selLabel = formatDay(sel);
  const selDetail = sv
    ? [
        `${sv.reserveMm} of ${sv.capMm} mm`,
        ...(sv.rain ? [`rain ${sv.rain} mm`] : []),
        ...(sv.irr ? [`irrigated ${sv.irr} mm`] : []),
        ...(selFc ? ["forecast · no water logged"] : []),
      ].join(" · ")
    : "No soil data shown for this day";
  const cta = sel === state?.realToday ? "Back to the real date" : sel === today ? "Keep this day" : selFc ? `Preview ${selLabel}` : `Replay ${selLabel}`;
  const canPick = sel >= min && sel <= max;
  const presets = <Presets today={today} demo={state?.demoDate != null} disabled={!state} onPick={pick} />;

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 20, background: v("bg"), color: v("ink"), display: "flex", flexDirection: "column", paddingTop: "env(safe-area-inset-top)" }}>
      {todayLoading ? (
        <>
          <Header onClose={onClose} fieldName={action?.name} />
          <Loader />
        </>
      ) : view === "year" ? (
        <YearView
          year={cursor.year}
          byDate={byDate}
          today={today}
          min={min}
          max={max}
          selMonth={sel.startsWith(`${cursor.year}-`) ? Number(sel.slice(5, 7)) - 1 : -1}
          fieldName={action?.name}
          loading={pending > 0}
          presets={presets}
          onClose={onClose}
          onToday={goToday}
          onYear={openYear}
          onOpenMonth={(mi) => openMonth(cursor.year, mi)}
        />
      ) : (
        <MonthView
          year={cursor.year}
          month={cursor.month}
          byDate={byDate}
          today={today}
          min={min}
          max={max}
          sel={sel}
          loading={pending > 0}
          presets={presets}
          onBack={() => openYear(cursor.year)}
          onMonth={(delta) => {
            const m = shiftMonth(cursor.year, cursor.month, delta);
            openMonth(m.year, m.month);
          }}
          onPick={setSel}
        />
      )}

      {!todayLoading && (
        <div style={{ borderTop: `1px solid ${v("line")}`, background: v("surface"), padding: "14px 16px calc(18px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 -6px 20px rgba(15, 24, 19, 0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ width: 54, height: 54, flex: "none", borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1, background: sv ? selScale.bg : v("sunk"), color: sv ? selScale.fg : v("ink2") }}>
              <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 24 }}>{sv?.pct ?? "–"}</span>
              <span style={{ fontSize: 10, fontWeight: 600 }}>%</span>
            </span>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 22, lineHeight: 1 }}>{selLabel}{sel === today ? " · today" : ""}</span>
                {sv && <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 999, padding: "2px 8px", background: selStatus.bg, color: selStatus.fg }}>{selStatus.tag}</span>}
              </span>
              <span style={{ fontSize: 13, color: v("ink2") }}>{selDetail}</span>
            </div>
          </div>
          <button type="button" onClick={() => pick(sel)} disabled={!canPick || !state} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 14, border: 0, background: canPick && state ? v("brand") : v("sunk"), color: canPick && state ? v("bg") : v("ink2"), fontWeight: 600, fontSize: 15, cursor: canPick && state ? "pointer" : "default" }}>
            {!state ? "Can't reach the API" : canPick ? cta : "Outside the available dates"}
          </button>
        </div>
      )}
    </div>
  );
}

function Header({ onClose, fieldName }: { onClose: () => void; fieldName?: string }) {
  return (
    <div style={{ padding: "12px 16px 8px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 30 }}>Pick a day</span>
        <span style={{ fontSize: 13, color: v("ink2") }}>Soil water of {fieldName ?? "the field"}</span>
      </div>
      <button type="button" onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: v("ink"), borderRadius: 22, background: v("sunk"), border: 0, cursor: "pointer" }}>
        <X size={20} />
      </button>
    </div>
  );
}

/** One-tap demo days and the real date: they move the date at once. */
function Presets({ today, demo, disabled, onPick }: { today: string; demo: boolean; disabled: boolean; onPick: (date: string | null) => void }) {
  const chip = (on: boolean): CSSProperties => ({
    flex: "none", height: 44, padding: "0 14px", borderRadius: 22, whiteSpace: "nowrap", fontSize: 13, fontWeight: 600,
    cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
    border: on ? `2px solid ${v("brand")}` : `1px solid ${v("line")}`, background: v("surface"), color: v("ink"),
  });
  return (
    <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "0 16px 10px" }}>
      {DATE_PRESETS.map((p) => (
        <button key={p.date} type="button" disabled={disabled} aria-pressed={today === p.date} onClick={() => onPick(p.date)} style={chip(today === p.date)}>{p.short}</button>
      ))}
      <button type="button" disabled={disabled} aria-pressed={!demo} onClick={() => onPick(null)} style={chip(!demo)}>Real date</button>
    </div>
  );
}

function Status({ loading }: { loading: boolean }) {
  return <div style={{ minHeight: 16, fontSize: 11, color: v("ink2"), padding: "0 16px 6px" }}>{loading ? "Loading soil water…" : ""}</div>;
}

function YearView({ year, byDate, today, min, max, selMonth, fieldName, loading, presets, onClose, onToday, onYear, onOpenMonth }: {
  year: number; byDate: Record<string, HeatDay>; today: string; min: string; max: string; selMonth: number;
  fieldName?: string; loading: boolean; presets: ReactNode; onClose: () => void; onToday: () => void;
  onYear: (year: number) => void; onOpenMonth: (mi: number) => void;
}) {
  const canPrev = year - 1 >= Number(min.slice(0, 4));
  const canNext = year + 1 <= Number(max.slice(0, 4));
  return (
    <>
      <Header onClose={onClose} fieldName={fieldName} />
      {presets}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "0 16px 4px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button type="button" onClick={() => onYear(year - 1)} disabled={!canPrev} aria-label="Previous year" style={{ width: 44, height: 44, borderRadius: 22, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), display: "flex", alignItems: "center", justifyContent: "center", cursor: canPrev ? "pointer" : "default", opacity: canPrev ? 1 : 0.35 }}>
            <ChevronLeft size={18} />
          </button>
          <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 22, minWidth: 52, textAlign: "center" }}>{year}</span>
          <button type="button" onClick={() => onYear(year + 1)} disabled={!canNext} aria-label="Next year" style={{ width: 44, height: 44, borderRadius: 22, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), display: "flex", alignItems: "center", justifyContent: "center", cursor: canNext ? "pointer" : "default", opacity: canNext ? 1 : 0.35 }}>
            <ChevronRight size={18} />
          </button>
        </span>
        <button type="button" onClick={onToday} style={{ height: 44, padding: "0 14px", borderRadius: 22, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Today</button>
      </div>
      <Status loading={loading} />
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 16px 12px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
          {MONTHS.map((name, mi) => {
            const inRange = monthInRange(year, mi, min, max);
            const cells: { style: CSSProperties }[] = [];
            const vals: number[] = [];
            for (let i = 0; i < offsetOf(year, mi); i++) cells.push({ style: { background: "transparent" } });
            for (let d = 1; d <= daysIn(year, mi); d++) {
              const iso = isoOf(year, mi, d);
              const dv = byDate[iso];
              if (dv) vals.push(dv.pct);
              const st: CSSProperties = { aspectRatio: "1", borderRadius: 2, background: dv ? scale(dv.pct).bg : v("sunk") };
              if (iso === today) {
                st.outline = `1.5px solid ${v("ink")}`;
                st.outlineOffset = "1px";
              }
              cells.push({ style: st });
            }
            const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
            return (
              <button key={mi} type="button" onClick={() => inRange && onOpenMonth(mi)} disabled={!inRange} aria-label={`${name} ${year}${avg !== null ? `, average soil water ${avg}%` : ""}`} style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, borderRadius: 12, color: v("ink"), cursor: inRange ? "pointer" : "default", opacity: inRange ? 1 : 0.4, textAlign: "left", background: v("surface"), border: mi === selMonth ? `2px solid ${v("ink")}` : `1px solid ${v("line")}` }}>
                <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", width: "100%" }}>
                  <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 18, lineHeight: 1 }}>{name.slice(0, 3)}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: v("ink2") }}>{avg !== null ? `${avg}%` : ""}</span>
                </span>
                <span style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 2, width: "100%" }}>
                  {cells.map((c, i) => <span key={i} style={c.style} />)}
                </span>
              </button>
            );
          })}
        </div>
        <Scale />
      </div>
    </>
  );
}

function MonthView({ year, month, byDate, today, min, max, sel, loading, presets, onBack, onMonth, onPick }: {
  year: number; month: number; byDate: Record<string, HeatDay>; today: string; min: string; max: string; sel: string;
  loading: boolean; presets: ReactNode; onBack: () => void; onMonth: (delta: number) => void; onPick: (date: string) => void;
}) {
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const canPrev = monthInRange(prev.year, prev.month, min, max);
  const canNext = monthInRange(next.year, next.month, min, max);
  const days: ReactNode[] = [];
  for (let i = 0; i < offsetOf(year, month); i++) days.push(<span key={`b${i}`} />);
  for (let d = 1; d <= daysIn(year, month); d++) {
    const iso = isoOf(year, month, d);
    const dv = byDate[iso];
    const isToday = iso === today;
    const selected = iso === sel;
    const dow = DOW[new Date(Date.UTC(year, month, d)).getUTCDay()];
    if (iso < min || iso > max) {
      days.push(
        <div key={iso} aria-label={`${dow} ${d} ${MONTHS[month]} ${year}, not available`} style={{ height: 52, borderRadius: 10, background: v("sunk"), color: v("ink2"), opacity: 0.4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{d}</div>,
      );
      continue;
    }
    const fc = iso > today;
    const c = dv ? scale(dv.pct) : null;
    const bg = !c ? v("surface") : fc ? `${c.bg} repeating-linear-gradient(45deg, rgba(246,243,232,0.35) 0 3px, transparent 3px 7px)` : c.bg;
    const chip = dv && dv.irr > 0 ? { color: "#182E22", label: dv.irr } : dv && dv.rain > 0 ? { color: RAIN, label: dv.rain } : null;
    const aria = `${dow} ${d} ${MONTHS[month]} ${year}${dv ? `, soil water ${dv.pct}%` : ", no soil data"}${dv?.rain ? `, rain ${dv.rain} mm` : ""}${dv?.irr ? `, irrigated ${dv.irr} mm` : ""}${fc ? ", after today" : ""}`;
    days.push(
      <button key={iso} type="button" onClick={() => onPick(iso)} aria-label={aria} aria-pressed={selected} style={{ position: "relative", overflow: "hidden", height: 52, paddingBottom: chip ? 16 : 0, borderRadius: 10, border: fc ? "1.5px dashed rgba(24,46,34,0.55)" : c ? 0 : `1px solid ${v("line")}`, background: bg, color: c ? c.fg : v("ink"), fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", outline: selected ? `3px solid ${v("ink")}` : "none", outlineOffset: selected ? 2 : 0 }}>
        <span>{d}</span>
        {isToday && <span style={{ position: "absolute", top: 0, left: 0, width: 0, height: 0, borderTop: `13px solid ${v("ink")}`, borderRight: "13px solid transparent" }} />}
        {chip && (
          <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 17, background: chip.color, color: "#F6F3E8", display: "flex", alignItems: "center", justifyContent: "center", gap: 2, fontSize: 10, fontWeight: 700 }}>{chip.label}</span>
        )}
      </button>,
    );
  }

  return (
    <>
      <div style={{ padding: "12px 12px 8px", display: "flex", alignItems: "center", gap: 6 }}>
        <button type="button" onClick={onBack} aria-label={`All months of ${year}`} style={{ height: 44, padding: "0 12px 0 6px", display: "flex", alignItems: "center", gap: 2, border: 0, borderRadius: 22, background: v("sunk"), color: v("ink"), fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
          <ArrowLeft size={18} />{year}
        </button>
        <span style={{ flex: 1, textAlign: "center", fontFamily: font.display, fontWeight: 700, fontSize: 24, lineHeight: 1 }}>{MONTHS[month]} {year}</span>
        <button type="button" onClick={() => onMonth(-1)} disabled={!canPrev} aria-label="Previous month" style={{ width: 44, height: 44, borderRadius: 22, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), display: "flex", alignItems: "center", justifyContent: "center", cursor: canPrev ? "pointer" : "default", opacity: canPrev ? 1 : 0.35 }}>
          <ChevronLeft size={18} />
        </button>
        <button type="button" onClick={() => onMonth(1)} disabled={!canNext} aria-label="Next month" style={{ width: 44, height: 44, borderRadius: 22, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), display: "flex", alignItems: "center", justifyContent: "center", cursor: canNext ? "pointer" : "default", opacity: canNext ? 1 : 0.35 }}>
          <ChevronRight size={18} />
        </button>
      </div>
      {presets}
      <Status loading={loading} />
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 16px 12px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6, paddingBottom: 6, fontSize: 11, fontWeight: 600, color: v("ink2"), textAlign: "center" }}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d}>{d}</span>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>{days}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 14px", fontSize: 11, color: v("ink2"), alignItems: "center", marginTop: 14 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ display: "inline-flex", alignItems: "center", height: 15, padding: "0 5px", borderRadius: 3, background: RAIN, color: "#F6F3E8", fontSize: 9, fontWeight: 700 }}>12</span>Rain, mm</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ display: "inline-flex", alignItems: "center", height: 15, padding: "0 5px", borderRadius: 3, background: "#182E22", color: "#F6F3E8", fontSize: 9, fontWeight: 700 }}>35</span>Irrigation, mm</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 0, height: 0, borderTop: `10px solid ${v("ink")}`, borderRight: "10px solid transparent" }} />Today</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 3, border: `1.5px dashed ${v("ink2")}`, boxSizing: "border-box" }} />After today</span>
        </div>
        <Scale />
      </div>
    </>
  );
}

function Scale() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: v("ink2"), marginTop: 12 }}>
      <span>Dry</span>
      <span style={{ display: "flex", gap: 3, flex: 1 }}>
        {["#B26A1E", "#E2B377", "#A9D3C8", "#3F9384", "#1F6B60"].map((c) => (
          <span key={c} style={{ flex: 1, height: 10, borderRadius: 3, background: c }} />
        ))}
      </span>
      <span>Full</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: v("sunk") }} />No data</span>
    </div>
  );
}
