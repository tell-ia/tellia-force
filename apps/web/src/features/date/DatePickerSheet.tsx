import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { FarmToday } from "@tellia/shared";
import { getFarmToday, getSeasonHeatmap, type SeasonHeatmap, type HeatDay } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { useFarm } from "../../app/FarmContext";
import { useDemoDate } from "../../app/DateContext";
import { font, v } from "../../theme/tokens";
import { Loader } from "../../components/ui/Loader";

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
function layout(year: number, mi: number): { offset: number; nd: number } {
  const first = new Date(Date.UTC(year, mi, 1));
  return { offset: (first.getUTCDay() + 6) % 7, nd: new Date(Date.UTC(year, mi + 1, 0)).getUTCDate() };
}
const mmdd = (mi: number, d: number) => `${String(mi + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function DatePickerSheet({ onClose }: { onClose: () => void }) {
  const { farm } = useFarm();
  const { today, state, setDate } = useDemoDate();
  // The demo date is global on the server (one "today" for app + chat + VAPI).
  // Picking a day moves that date for everyone; effectiveAsOf === today here.
  const effectiveAsOf = today;
  const maxDate = state?.max ?? today;

  // Anchor at the project's today → a stable season heatmap, independent of the
  // currently-selected day. The heatmap stitches several reports server-side.
  const { data: todayData, loading: todayLoading } = useAsync<FarmToday | null>(
    () => (farm ? getFarmToday(farm) : Promise.resolve(null)),
    [farm?.id, today],
  );
  const action = todayData?.parcels.find((p) => p.status === "action") ?? todayData?.parcels[0];
  const fieldId = action?.id ?? null;
  const { data: heat, loading: heatLoading, error } = useAsync<SeasonHeatmap | null>(
    () => (fieldId ? getSeasonHeatmap(fieldId, today) : Promise.resolve(null)),
    [fieldId, today],
  );

  // Loading while the farm's today resolves, while the heatmap fetches, and in the
  // frame after a fieldId appears but its heatmap effect hasn't run yet — so the
  // "couldn't load" branch only shows on a real failure, not mid-chain.
  const loading = todayLoading || heatLoading || (fieldId !== null && !heat && !error);
  const ready = !loading && !!heat;
  const year = heat?.year ?? Number(today.slice(0, 4));
  const byKey = heat?.byKey ?? {};
  const firstMonth = heat ? Number(heat.minDate.slice(5, 7)) - 1 : 0;
  const lastMonth = heat ? Number(heat.maxDate.slice(5, 7)) - 1 : 11;
  const todayKey = today.slice(5);

  const defaultSel = useMemo(() => {
    if (!heat) return todayKey;
    if (effectiveAsOf.slice(0, 4) === String(year) && byKey[effectiveAsOf.slice(5)]) return effectiveAsOf.slice(5);
    if (byKey[todayKey]) return todayKey;
    return heat.maxDate.slice(5);
  }, [heat]); // eslint-disable-line react-hooks/exhaustive-deps

  const [view, setView] = useState<"year" | "month">("month");
  const [selState, setSelState] = useState<string | null>(null);
  const [monthState, setMonthState] = useState<number | null>(null);
  const sel = selState ?? defaultSel;
  const month = monthState ?? Math.min(lastMonth, Math.max(firstMonth, Number(sel.slice(0, 2)) - 1));

  const confirm = () => {
    const full = `${year}-${sel}`;
    // null = back to the server's real today; otherwise move the demo date.
    void setDate(full === state?.realToday ? null : full);
    onClose();
  };
  const goToday = () => {
    setSelState(todayKey);
    setMonthState(Number(todayKey.slice(0, 2)) - 1);
    setView("month");
  };

  const selDate = `${year}-${sel}`;
  const sv = byKey[sel];
  const selFc = selDate > today;
  const selScale = scale(sv?.pct ?? 0);
  const selStatus = status(sv?.pct ?? 0, selFc);
  const sm = Number(sel.slice(0, 2));
  const sd = Number(sel.slice(3, 5));
  const selDow = DOW[new Date(Date.UTC(year, sm - 1, sd)).getUTCDay()];
  const selLabel = `${selDow} ${sd} ${MONTHS[sm - 1]!.slice(0, 3)}`;
  const selDetail = sv
    ? [
        `${sv.reserveMm} of ${sv.capMm} mm`,
        ...(sv.rain ? [`rain ${sv.rain} mm`] : []),
        ...(sv.irr ? [`irrigated ${sv.irr} mm`] : []),
        ...(selFc ? ["forecast · no water logged"] : []),
      ].join(" · ")
    : "No data for this day";
  const cta = sel === todayKey ? "Back to today" : selFc ? `Preview ${selLabel}` : `Replay ${selLabel}`;
  const canPick = !!sv && selDate <= maxDate;

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 20, background: v("bg"), color: v("ink"), display: "flex", flexDirection: "column", paddingTop: "env(safe-area-inset-top)" }}>
      {loading ? (
        <>
          <Header onClose={onClose} fieldName={action?.name} year={year} />
          <Loader />
        </>
      ) : error || !heat ? (
        <>
          <Header onClose={onClose} fieldName={action?.name} year={year} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, textAlign: "center" }}>
            <span style={{ fontSize: 15, color: v("ink2") }}>Couldn't load the season for this field.</span>
            <button type="button" onClick={onClose} style={{ height: 44, padding: "0 18px", borderRadius: 22, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), fontWeight: 600, cursor: "pointer" }}>Close</button>
          </div>
        </>
      ) : view === "year" ? (
        <YearView
          year={year}
          byKey={byKey}
          todayKey={todayKey}
          selMonth={Number(sel.slice(0, 2)) - 1}
          fieldName={action?.name ?? "Field"}
          onClose={onClose}
          onToday={goToday}
          onOpenMonth={(mi) => {
            setMonthState(mi);
            setView("month");
          }}
        />
      ) : (
        <MonthView
          year={year}
          month={month}
          byKey={byKey}
          today={today}
          maxDate={maxDate}
          sel={sel}
          firstMonth={firstMonth}
          lastMonth={lastMonth}
          onBack={() => setView("year")}
          onPrev={() => setMonthState(Math.max(firstMonth, month - 1))}
          onNext={() => setMonthState(Math.min(lastMonth, month + 1))}
          onPick={(k) => setSelState(k)}
        />
      )}

      {ready && !error && (
        <div style={{ borderTop: `1px solid ${v("line")}`, background: v("surface"), padding: "14px 16px calc(18px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 -6px 20px rgba(15, 24, 19, 0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ width: 54, height: 54, flex: "none", borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1, background: sv ? selScale.bg : v("sunk"), color: sv ? selScale.fg : v("ink2") }}>
              <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 24 }}>{sv?.pct ?? "–"}</span>
              <span style={{ fontSize: 10, fontWeight: 600 }}>%</span>
            </span>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 22, lineHeight: 1 }}>{selLabel}{sel === todayKey ? " · today" : ""}</span>
                {sv && <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 999, padding: "2px 8px", background: selStatus.bg, color: selStatus.fg }}>{selStatus.tag}</span>}
              </span>
              <span style={{ fontSize: 13, color: v("ink2") }}>{selDetail}</span>
            </div>
          </div>
          <button type="button" onClick={confirm} disabled={!canPick} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 14, border: 0, background: canPick ? v("brand") : v("sunk"), color: canPick ? v("bg") : v("ink2"), fontWeight: 600, fontSize: 15, cursor: canPick ? "pointer" : "default" }}>
            {canPick ? cta : "No data for this day"}
          </button>
        </div>
      )}
    </div>
  );
}

function Header({ onClose, fieldName, year }: { onClose: () => void; fieldName?: string; year: number }) {
  return (
    <div style={{ padding: "12px 16px 8px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 30 }}>Pick a day</span>
        <span style={{ fontSize: 13, color: v("ink2") }}>{fieldName ?? "Field"} · {year}</span>
      </div>
      <button type="button" onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: v("ink"), borderRadius: 22, background: v("sunk"), border: 0, cursor: "pointer" }}>
        <X size={20} />
      </button>
    </div>
  );
}

function YearView({ year, byKey, todayKey, selMonth, fieldName, onClose, onToday, onOpenMonth }: {
  year: number; byKey: Record<string, HeatDay>; todayKey: string; selMonth: number;
  fieldName: string; onClose: () => void; onToday: () => void; onOpenMonth: (mi: number) => void;
}) {
  return (
    <>
      <Header onClose={onClose} fieldName={fieldName} year={year} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "0 16px 10px" }}>
        <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 22 }}>{year}</span>
        <button type="button" onClick={onToday} style={{ height: 44, padding: "0 14px", borderRadius: 22, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Today</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 16px 12px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
          {MONTHS.map((name, mi) => {
            const { offset, nd } = layout(year, mi);
            const cells: { style: CSSProperties }[] = [];
            const vals: number[] = [];
            for (let i = 0; i < offset; i++) cells.push({ style: { background: "transparent" } });
            for (let d = 1; d <= nd; d++) {
              const key = mmdd(mi, d);
              const dv = byKey[key];
              if (dv) vals.push(dv.pct);
              const st: CSSProperties = { aspectRatio: "1", borderRadius: 2, background: dv ? scale(dv.pct).bg : v("sunk") };
              if (key === todayKey) {
                st.outline = `1.5px solid ${v("ink")}`;
                st.outlineOffset = "1px";
              }
              cells.push({ style: st });
            }
            const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
            const hasData = avg !== null;
            return (
              <button key={mi} type="button" onClick={() => hasData && onOpenMonth(mi)} disabled={!hasData} aria-label={`${name}${hasData ? `, average soil water ${avg}%` : ", no data"}`} style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, borderRadius: 12, color: v("ink"), cursor: hasData ? "pointer" : "default", opacity: hasData ? 1 : 0.5, textAlign: "left", background: v("surface"), border: mi === selMonth ? `2px solid ${v("ink")}` : `1px solid ${v("line")}` }}>
                <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", width: "100%" }}>
                  <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 18, lineHeight: 1 }}>{name.slice(0, 3)}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: v("ink2") }}>{hasData ? `${avg}%` : ""}</span>
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

function MonthView({ year, month, byKey, today, maxDate, sel, firstMonth, lastMonth, onBack, onPrev, onNext, onPick }: {
  year: number; month: number; byKey: Record<string, HeatDay>; today: string; maxDate: string; sel: string;
  firstMonth: number; lastMonth: number; onBack: () => void; onPrev: () => void; onNext: () => void; onPick: (k: string) => void;
}) {
  const { offset, nd } = layout(year, month);
  const todayKey = today.slice(5);
  const days: ReactNode[] = [];
  for (let i = 0; i < offset; i++) days.push(<span key={`b${i}`} />);
  for (let d = 1; d <= nd; d++) {
    const key = mmdd(month, d);
    const dv = byKey[key];
    const isToday = key === todayKey;
    const selected = key === sel;
    if (!dv || `${year}-${key}` > maxDate) {
      days.push(
        <div key={key} aria-label={`${d} ${MONTHS[month]}, no data`} style={{ height: 52, borderRadius: 10, background: v("sunk"), color: v("ink2"), opacity: 0.5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{d}</div>,
      );
      continue;
    }
    const c = scale(dv.pct);
    const fc = `${year}-${key}` > today;
    const bg = fc ? `${c.bg} repeating-linear-gradient(45deg, rgba(246,243,232,0.35) 0 3px, transparent 3px 7px)` : c.bg;
    const chip = dv.irr > 0 ? { color: "#182E22", label: dv.irr } : dv.rain > 0 ? { color: RAIN, label: dv.rain } : null;
    const aria = `${DOW[new Date(Date.UTC(year, month, d)).getUTCDay()]} ${d} ${MONTHS[month]}, soil water ${dv.pct}%${dv.rain ? `, rain ${dv.rain} mm` : ""}${dv.irr ? `, irrigated ${dv.irr} mm` : ""}${fc ? ", forecast" : ""}`;
    days.push(
      <button key={key} type="button" onClick={() => onPick(key)} aria-label={aria} aria-pressed={selected} style={{ position: "relative", overflow: "hidden", height: 52, paddingBottom: chip ? 16 : 0, borderRadius: 10, border: fc ? "1.5px dashed rgba(24,46,34,0.55)" : 0, background: bg, color: c.fg, fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", outline: selected ? `3px solid ${v("ink")}` : "none", outlineOffset: selected ? 2 : 0 }}>
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
        <button type="button" onClick={onBack} style={{ height: 44, padding: "0 12px 0 6px", display: "flex", alignItems: "center", gap: 2, border: 0, borderRadius: 22, background: v("sunk"), color: v("ink"), fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
          <ArrowLeft size={18} />{year}
        </button>
        <span style={{ flex: 1, textAlign: "center", fontFamily: font.display, fontWeight: 700, fontSize: 24, lineHeight: 1 }}>{MONTHS[month]} {year}</span>
        <button type="button" onClick={onPrev} disabled={month <= firstMonth} aria-label="Previous month" style={{ width: 44, height: 44, borderRadius: 22, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", opacity: month <= firstMonth ? 0.35 : 1 }}>
          <ChevronLeft size={18} />
        </button>
        <button type="button" onClick={onNext} disabled={month >= lastMonth} aria-label="Next month" style={{ width: 44, height: 44, borderRadius: 22, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", opacity: month >= lastMonth ? 0.35 : 1 }}>
          <ChevronRight size={18} />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 16px 12px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6, paddingBottom: 6, fontSize: 11, fontWeight: 600, color: v("ink2"), textAlign: "center" }}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d}>{d}</span>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>{days}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 14px", fontSize: 11, color: v("ink2"), alignItems: "center", marginTop: 14 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ display: "inline-flex", alignItems: "center", height: 15, padding: "0 5px", borderRadius: 3, background: RAIN, color: "#F6F3E8", fontSize: 9, fontWeight: 700 }}>12</span>Rain, mm</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ display: "inline-flex", alignItems: "center", height: 15, padding: "0 5px", borderRadius: 3, background: "#182E22", color: "#F6F3E8", fontSize: 9, fontWeight: 700 }}>35</span>Irrigation, mm</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 0, height: 0, borderTop: `10px solid ${v("ink")}`, borderRight: "10px solid transparent" }} />Today</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 3, border: `1.5px dashed ${v("ink2")}`, boxSizing: "border-box" }} />Forecast</span>
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
