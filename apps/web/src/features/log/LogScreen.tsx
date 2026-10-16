import { useMemo, useState } from "react";
import { Check, Mic } from "lucide-react";
import type { ParcelReport } from "@tellia/shared";
import { getParcelReport, recordIrrigation } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { navigate } from "../../app/router";
import { font, radius, v } from "../../theme/tokens";
import { Label } from "../../components/ui/primitives";

const VALLEY_ID = 101;
const EFFICIENCY = 0.8;
const WAVE = [10, 18, 30, 22, 14, 26, 38, 30, 20, 12, 22, 34, 42, 28, 18, 10, 16, 26, 36, 24, 14, 20, 30, 18, 10, 14, 8, 6];

export function LogScreen() {
  const { data } = useAsync<ParcelReport>(() => getParcelReport(VALLEY_ID), []);
  const [amount, setAmount] = useState(35);
  const [status, setStatus] = useState<"planned" | "done">("planned");
  const [logged, setLogged] = useState(false);

  const gross = Math.round(amount / EFFICIENCY);

  // Forecast window (day 9 → 18) from the real report: reserve without water, and
  // the optimistic "with X mm" line the farmer's entry produces.
  const win = useMemo(() => (data ? data.series.filter((p) => Number(p.dayLabel) >= 9) : []), [data]);
  const cap = data?.reserve.capacityMm ?? 144;
  const threshold = data?.reserve.thresholdMm ?? 79;

  const confirm = () => {
    setLogged(true);
    void recordIrrigation({ parcelId: VALLEY_ID, date: "2022-07-14", netMm: amount, grossMm: gross, status, source: "voice" });
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16, padding: "12px 16px 20px" }}>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1, padding: "4px 4px 0" }}>
        <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 34 }}>Log watering</span>
        <span style={{ fontSize: 13, color: v("ink2") }}>Speak it, check it, save it.</span>
      </div>

      {logged && (
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, background: v("brand"), color: v("bg"), borderRadius: radius.card, padding: "12px 14px" }}>
          <Check size={20} strokeWidth={2.5} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            {status === "done" ? "Saved as done. The reserve is updated." : "Saved as planned. Forecast updated — confirm once done."}
          </span>
        </div>
      )}

      {/* Voice capture (recording mocked) */}
      <section style={{ background: "#234534", color: "#F6F3E8", borderRadius: radius.hero, padding: "18px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button type="button" aria-label="Hold to speak" style={{ width: 64, height: 64, flex: "none", borderRadius: 32, border: 0, background: "#F6F3E8", color: "#234534", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 8px rgba(246, 243, 232, 0.14)", cursor: "pointer" }}>
            <Mic size={26} />
          </button>
          <div aria-hidden="true" style={{ flex: 1, display: "flex", alignItems: "center", gap: 3, height: 44 }}>
            {WAVE.map((h, i) => (
              <span key={i} style={{ flex: 1, height: h, borderRadius: 2, background: "#F6F3E8" }} />
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "#C7D8CC" }}>Heard · 0:05</span>
          <span style={{ fontFamily: font.display, fontWeight: 500, fontSize: 24, lineHeight: 1.15 }}>
            “Thirty-five millimetres on The Valley, Thursday evening, with the reel gun.”
          </span>
          <span style={{ fontSize: 12, color: "#C7D8CC" }}>Read as {amount} mm net to the soil, the dose TelliaForce recommended.</span>
        </div>
      </section>

      {/* Parsed details */}
      <section aria-label="Details" style={{ background: v("surface"), border: `1px solid ${v("line")}`, borderRadius: radius.section, padding: "6px 16px", display: "flex", flexDirection: "column" }}>
        <Row label="Parcel" value="The Valley" />
        <Row label="Date" value="Thu 14 Jul · evening" />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 60, borderBottom: `1px solid ${v("line")}` }}>
          <span style={{ fontSize: 13, color: v("ink2") }}>Net to soil</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <StepBtn label="Less" onClick={() => { setAmount((a) => Math.max(10, a - 5)); setLogged(false); }}>−</StepBtn>
            <span style={{ width: 76, textAlign: "center", fontFamily: font.display, fontWeight: 700, fontSize: 30, color: v("ink") }}>{amount} mm</span>
            <StepBtn label="More" onClick={() => { setAmount((a) => Math.min(60, a + 5)); setLogged(false); }}>+</StepBtn>
          </span>
        </div>
        <Row label="Method" value={`Reel gun · ≈ ${gross} mm at the gun`} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 60 }}>
          <span style={{ fontSize: 13, color: v("ink2") }}>Status</span>
          <span style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 4, background: v("sunk"), borderRadius: radius.tile, padding: 3 }}>
            <SegBtn on={status === "planned"} onClick={() => setStatus("planned")}>Planned</SegBtn>
            <SegBtn on={status === "done"} onClick={() => setStatus("done")}>Done</SegBtn>
          </span>
        </div>
      </section>

      {/* Effect on soil water */}
      <section style={{ background: v("surface"), border: `1px solid ${v("line")}`, borderRadius: radius.section, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <Label>Effect on soil water</Label>
          <span style={{ fontSize: 12, fontWeight: 600, color: logged ? v("water") : v("ink2") }}>{logged ? "Updated" : "Before logging"}</span>
        </div>
        <EffectTiles win={win} cap={cap} threshold={threshold} amount={logged ? amount : 0} />
        <LogEffectChart win={win} cap={cap} threshold={threshold} amount={amount} logged={logged} status={status} />
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        {logged ? (
          <button type="button" onClick={() => setLogged(false)} style={{ height: 54, borderRadius: radius.card, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), fontWeight: 600, cursor: "pointer" }}>Undo</button>
        ) : (
          <button type="button" onClick={() => navigate("parcel/101")} style={{ height: 54, borderRadius: radius.card, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), fontWeight: 600, cursor: "pointer" }}>Cancel</button>
        )}
        <button type="button" onClick={confirm} style={{ height: 54, borderRadius: radius.card, border: 0, fontWeight: 600, fontSize: 16, cursor: "pointer", background: logged ? v("okSoft") : v("brand"), color: logged ? v("brand") : v("bg") }}>
          {logged ? "Saved" : `Confirm ${amount} mm`}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 52, borderBottom: `1px solid ${v("line")}` }}>
      <span style={{ fontSize: 13, color: v("ink2") }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function StepBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} style={{ width: 44, height: 44, borderRadius: 22, border: `1px solid ${v("line")}`, background: v("bg"), color: v("ink"), fontSize: 20, lineHeight: 1, cursor: "pointer" }}>{children}</button>
  );
}

function SegBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} style={{ minWidth: 84, height: 40, border: 0, borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: "pointer", background: on ? v("surface") : "transparent", color: on ? v("ink") : v("ink2"), boxShadow: on ? "0 1px 2px rgba(15, 24, 19, 0.12)" : "none" }}>{children}</button>
  );
}

interface WinPoint { dayLabel: string; reserveMm: number; forecast: boolean }

function pctOf(mm: number, cap: number): number {
  return Math.round((mm / cap) * 100);
}

function EffectTiles({ win, cap, threshold, amount }: { win: WinPoint[]; cap: number; threshold: number; amount: number }) {
  const at = (day: string) => win.find((p) => p.dayLabel === day);
  const withMm = (p?: WinPoint) => (p ? Math.min(cap, p.reserveMm + amount) : 0);
  const fri = at("15");
  const mon = at("18");
  let stressDay = "Not this week";
  const eve = ["Wed eve", "Thu eve", "Fri eve", "Sat eve", "Sun eve"];
  for (let i = 0; i < win.length; i++) {
    const p = win[i]!;
    if (p.forecast && Math.min(cap, p.reserveMm + amount) < threshold) {
      stressDay = eve[Number(p.dayLabel) - 14] ?? "this week";
      break;
    }
  }
  const tile = (caption: string, p: WinPoint | undefined) => {
    const pct = pctOf(withMm(p), cap);
    const low = pct < 55;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2, background: v("sunk"), borderRadius: radius.tile, padding: 10 }}>
        <span style={{ fontSize: 11, color: v("ink2") }}>{caption}</span>
        <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 30, lineHeight: 1, color: low ? v("act") : v("water") }}>{pct}%</span>
        <span style={{ fontSize: 11, color: v("ink2") }}>{amount > 0 ? `was ${pctOf(p?.reserveMm ?? 0, cap)}%` : "without water"}</span>
      </div>
    );
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
      {tile("Fri 15", fri)}
      {tile("Mon 18", mon)}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, background: stressDay === "Not this week" ? v("okSoft") : v("actSoft"), borderRadius: radius.tile, padding: 10 }}>
        <span style={{ fontSize: 11, color: v("ink2") }}>Hits threshold</span>
        <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>{stressDay}</span>
        <span style={{ fontSize: 11, color: v("ink2") }}>next 5 days</span>
      </div>
    </div>
  );
}

function LogEffectChart({ win, cap, threshold, amount, logged, status }: { win: WinPoint[]; cap: number; threshold: number; amount: number; logged: boolean; status: "planned" | "done" }) {
  if (win.length === 0) return null;
  const x = (i: number) => 24 + i * (294 / Math.max(1, win.length - 1));
  const y = (mm: number) => 150 - (mm - 40) * 1.25;
  const yThr = y(threshold);
  const todayIdx = win.reduce((acc, p, i) => (p.forecast ? acc : i), 0);
  const pt = (i: number, mm: number) => `${x(i).toFixed(1)},${y(mm).toFixed(1)}`;
  const pastPts = win.map((p, i) => (p.forecast ? null : pt(i, p.reserveMm))).filter(Boolean).join(" ");
  const basePts = [pt(todayIdx, win[todayIdx]!.reserveMm), ...win.map((p, i) => (p.forecast ? pt(i, p.reserveMm) : null)).filter(Boolean)].join(" ");
  const withPts = [pt(todayIdx, win[todayIdx]!.reserveMm), ...win.map((p, i) => (p.forecast ? pt(i, Math.min(cap, p.reserveMm + amount)) : null)).filter(Boolean)].join(" ");
  return (
    <svg viewBox="0 0 326 176" width="100%" role="img" aria-label={logged ? `Soil reserve with ${amount} mm stays above the ${threshold} mm threshold` : `Soil reserve without water reaches the ${threshold} mm threshold this week`} style={{ display: "block", marginLeft: -4, fontFamily: font.body }}>
      <defs>
        <pattern id="tfFc2" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke={v("ink2")} strokeWidth={1} opacity={0.22} />
        </pattern>
      </defs>
      <rect x={x(todayIdx)} y="10" width={326 - x(todayIdx)} height="146" fill="url(#tfFc2)" />
      <text x={x(todayIdx) + 5} y="20" fill={v("ink2")} fontSize="10" fontWeight={600} letterSpacing="0.08em">FORECAST</text>
      <line x1="22" y1="150" x2="320" y2="150" stroke={v("line")} />
      <line x1="22" y1={yThr} x2="320" y2={yThr} stroke={v("act")} strokeWidth={1.5} strokeDasharray="5 3" />
      <text x="18" y={yThr + 3} textAnchor="end" fill={v("act")} fontSize="10" fontWeight={600}>{threshold}</text>
      <polyline points={pastPts} fill="none" stroke={v("water")} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={basePts} fill="none" stroke={logged ? v("ink2") : v("act")} strokeWidth={2} strokeDasharray="2 4" strokeLinecap="round" />
      {logged && <polyline points={withPts} fill="none" stroke={v("water")} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={status === "done" ? "none" : "7 5"} />}
      <circle cx={x(todayIdx)} cy={y(win[todayIdx]!.reserveMm)} r="5" fill={v("water")} stroke={v("surface")} strokeWidth={2.5} />
      {win.map((p, i) => (i % 2 === 0 ? <text key={i} x={x(i)} y="170" textAnchor="middle" fill={i === todayIdx ? v("ink") : v("ink2")} fontSize={i === todayIdx ? 11 : 10} fontWeight={i === todayIdx ? 700 : 400}>{p.dayLabel}</text> : null))}
    </svg>
  );
}
