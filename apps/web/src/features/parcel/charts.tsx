import { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import type { BalancePoint, CropTimeline, NextDay, Reserve, SeasonBalance, Soil } from "@tellia/shared";
import { font, radius, v } from "../../theme/tokens";
import { Label, StatTile } from "../../components/ui/primitives";

// Charts are plain React + SVG driven by props. Geometry reproduces the hi-fi
// prototype (viewBox, scales, colors), computed from the data so it stays true
// to the numbers. Pure view mapping; no business logic.

// ---- Soil water reserve gauge --------------------------------------------

export function ReserveGauge({ reserve }: { reserve: Reserve }) {
  const W = 326;
  const cap = reserve.capacityMm;
  const todayX = (reserve.availableMm / cap) * W;
  const thresholdX = (reserve.thresholdMm / cap) * W;
  const usedW = (reserve.usedByThresholdMm / cap) * W;
  const belowComfort = reserve.availableMm < reserve.thresholdMm;
  const fill = belowComfort ? v("act") : v("water");
  const todayAnchor = todayX < 150 ? "start" : "end";
  const todayLabelX = todayX < 150 ? todayX + 4 : todayX - 4;
  return (
    <svg viewBox="0 0 326 74" width="100%" role="img" aria-label={`${reserve.availableMm} mm available of ${cap}; comfort threshold ${reserve.thresholdMm} mm, reached ${reserve.thresholdLabel}`} style={{ display: "block", fontFamily: font.body }}>
      <defs>
        <pattern id="tfHatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" stroke={v("act")} strokeWidth={1.4} />
        </pattern>
        <clipPath id="tfTank"><rect x="0" y="20" width="326" height="30" rx="8" /></clipPath>
      </defs>
      <g clipPath="url(#tfTank)">
        <rect x="0" y="20" width="326" height="30" fill={v("sunk")} />
        {/* actual available water — red below the comfort threshold */}
        <rect x="0" y="20" width={todayX} height="30" fill={fill} />
        {/* what the crop will use by the threshold date */}
        {usedW > 0 && <rect x={todayX - usedW} y="20" width={usedW} height="30" fill="url(#tfHatch)" opacity={0.5} />}
      </g>
      <line x1={thresholdX} y1="12" x2={thresholdX} y2="58" stroke={v("ink")} strokeWidth={2} />
      <text x={thresholdX + 4} y="11" textAnchor="start" fill={v("ink")} fontSize="11" fontWeight={600}>Comfort {reserve.thresholdMm} mm</text>
      <text x={todayLabelX} y="11" textAnchor={todayAnchor} fill={fill} fontSize="11" fontWeight={600}>Today {reserve.pct}%</text>
      <text x="0" y="70" fill={v("ink2")} fontSize="11">0 · stress zone</text>
      <text x={thresholdX} y="70" textAnchor="middle" fill={v("act")} fontSize="11" fontWeight={600}>{reserve.thresholdLabel}</text>
      <text x="326" y="70" textAnchor="end" fill={v("ink2")} fontSize="11">Full {cap}</text>
    </svg>
  );
}

// ---- Water balance chart --------------------------------------------------

export function WaterBalanceChart({ series, reserve }: { series: BalancePoint[]; reserve: Reserve }) {
  const N = series.length;
  const cap = reserve.capacityMm;
  const dx = (312 - 30) / Math.max(1, N - 1);
  const xAt = (i: number) => 30 + i * dx;
  const yRes = (mm: number) => 104 + ((cap - mm) / (cap - 40)) * 92;
  const yThreshold = yRes(reserve.thresholdMm);

  const todayIndex = series.reduce((acc, p, i) => (p.forecast ? acc : i), 0);
  const firstFc = series.findIndex((p) => p.forecast);
  const fcX = firstFc >= 0 ? xAt(firstFc) - dx / 2 : 326;

  const resPt = (i: number) => `${xAt(i).toFixed(1)},${yRes(series[i]!.reserveMm).toFixed(1)}`;
  const pastPts = series.map((p, i) => (p.forecast ? null : resPt(i))).filter(Boolean).join(" ");
  const fcPts = [resPt(todayIndex), ...series.map((p, i) => (p.forecast ? resPt(i) : null)).filter(Boolean)].join(" ");
  const areaPts = `${xAt(0).toFixed(1)},196 ${series.map((_, i) => resPt(i)).join(" ")} ${xAt(N - 1).toFixed(1)},196`;

  const today = series[todayIndex]!;

  return (
    <svg viewBox="0 0 326 226" width="100%" role="img" aria-label={`Daily water in and out with the soil reserve line; reserve falls from ${reserve.availableMm} mm today, crossing the ${reserve.thresholdMm} mm threshold ${reserve.thresholdLabel}`} style={{ display: "block", marginLeft: -4, fontFamily: font.body }}>
      <defs>
        <pattern id="tfFc" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke={v("ink2")} strokeWidth={1} opacity={0.22} />
        </pattern>
      </defs>
      {firstFc >= 0 && <rect x={fcX} y="0" width={326 - fcX} height="204" fill="url(#tfFc)" />}
      {firstFc >= 0 && <text x={fcX + 5} y="11" fill={v("ink2")} fontSize="10" fontWeight={600} letterSpacing="0.08em">FORECAST</text>}
      <text x="0" y="11" fill={v("ink2")} fontSize="10">In ↑ / used ↓</text>
      <line x1="22" y1="50" x2="320" y2="50" stroke={v("line")} />

      {series.map((p, i) =>
        p.irrigation > 0 ? (
          <g key={`irr${i}`}>
            <rect x={xAt(i) - 4.5} y={50 - p.irrigation * 1.1} width="9" height={p.irrigation * 1.1} rx="2" fill={v("water")} />
            <text x={xAt(i)} y={50 - p.irrigation * 1.1 - 3} textAnchor="middle" fill={v("ink")} fontSize="10" fontWeight={600}>{p.irrigation}</text>
          </g>
        ) : null,
      )}
      {series.map((p, i) => (
        <rect key={`use${i}`} x={xAt(i) - 4.5} y="52" width="9" height={p.cropUse * 2.2} rx="2" fill={v("cons")} opacity={p.forecast ? 0.6 : 1} />
      ))}

      <text x="0" y="100" fill={v("ink2")} fontSize="10">Soil reserve</text>
      <text x="18" y="107" textAnchor="end" fill={v("ink2")} fontSize="10">{cap}</text>
      <text x="18" y="199" textAnchor="end" fill={v("ink2")} fontSize="10">40</text>
      <line x1="22" y1="104" x2="320" y2="104" stroke={v("line")} strokeDasharray="2 3" />
      <line x1="22" y1="196" x2="320" y2="196" stroke={v("line")} />
      <polygon points={areaPts} fill={v("waterSoft")} />
      <line x1="22" y1={yThreshold} x2="320" y2={yThreshold} stroke={v("act")} strokeWidth={1.5} strokeDasharray="5 3" />
      <text x="18" y={yThreshold + 3} textAnchor="end" fill={v("act")} fontSize="10" fontWeight={600}>{reserve.thresholdMm}</text>
      <polyline points={pastPts} fill="none" stroke={v("water")} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={fcPts} fill="none" stroke={v("water")} strokeWidth={2.5} strokeDasharray="2 4" strokeLinecap="round" />
      <line x1={xAt(todayIndex)} y1="22" x2={xAt(todayIndex)} y2="204" stroke={v("ink")} opacity={0.35} />
      <circle cx={xAt(todayIndex)} cy={yRes(today.reserveMm)} r="5" fill={v("water")} stroke={v("surface")} strokeWidth={2.5} />
      <text x={xAt(todayIndex) - 6} y={yRes(today.reserveMm) - 6} textAnchor="end" fill={v("ink")} fontSize="11" fontWeight={600}>{Math.round(today.reserveMm)}</text>

      {series.map((p, i) =>
        i % 2 === 0 ? (
          <text key={`lab${i}`} x={xAt(i)} y="220" textAnchor="middle" fill={i === todayIndex ? v("ink") : v("ink2")} fontSize={i === todayIndex ? 11 : 10} fontWeight={i === todayIndex ? 700 : 400}>{p.dayLabel}</text>
        ) : null,
      )}
    </svg>
  );
}

export function BalanceLegend() {
  const item = (swatch: React.ReactNode, label: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{swatch}{label}</span>
  );
  const sq = (c: string) => <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: "inline-block" }} />;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", fontSize: 12, color: v("ink2") }}>
      {item(sq(v("water")), "Irrigation")}
      {item(sq(v("cons")), "Crop use")}
      {item(<span style={{ width: 16, height: 3, borderRadius: 2, background: v("water"), display: "inline-block" }} />, "Reserve")}
      {item(<span style={{ width: 16, height: 0, borderTop: `2px dashed ${v("act")}`, display: "inline-block" }} />, "Comfort threshold")}
    </div>
  );
}

// ---- Crop stage timeline --------------------------------------------------

export function CropStageTimeline({ cropStage }: { cropStage: CropTimeline }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Label>Crop stage</Label>
        <span style={{ fontSize: 12, color: v("ink2") }}>day {cropStage.daysSinceSowing} since sowing</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ position: "relative", display: "flex", gap: 3, height: 14 }}>
          {cropStage.steps.map((s, i) => (
            <div key={i} style={{ flex: s.weight, borderRadius: 4, background: s.current ? v("act") : v("brand"), opacity: s.current ? 1 : 0.45 }} />
          ))}
          <div style={{ position: "absolute", left: `${cropStage.progress * 100}%`, top: -6, width: 3, height: 26, borderRadius: 2, background: v("ink") }} />
        </div>
        <div style={{ display: "flex", gap: 3, fontSize: 11, color: v("ink2") }}>
          {cropStage.steps.map((s, i) => (
            <div key={i} style={{ flex: s.weight, textAlign: "center", color: s.current ? v("act") : v("ink2"), fontWeight: s.current ? 600 : 400 }}>{s.label}</div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: v("actSoft"), borderRadius: radius.tile, padding: "10px 12px" }}>
        <AlertTriangle size={18} strokeWidth={2} style={{ flex: "none", marginTop: 2, color: v("act") }} />
        <span style={{ fontSize: 13, lineHeight: 1.45 }}>{cropStage.note}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        <StatTile caption="Growing degree-days" value={cropStage.gdd} sub={`°C·d, base ${cropStage.gddBase}`} />
        <StatTile caption="Crop use today" value={cropStage.useTodayMm} unit="mm" sub={`${cropStage.useTomorrowMm} mm tomorrow`} />
      </div>
    </div>
  );
}

// ---- Next 5 days ----------------------------------------------------------

export function NextDaysTable({ days }: { days: NextDay[] }) {
  const cols = "54px 34px minmax(0, 1fr) 52px";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Label>Next 5 days</Label>
        <span style={{ fontSize: 12, color: v("ink2") }}>% of usable reserve</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: "0 10px", alignItems: "center", fontSize: 11, color: v("ink2"), paddingBottom: 4, borderBottom: `1px solid ${v("line")}` }}>
        <span>Day</span>
        <span style={{ textAlign: "right" }}>Max</span>
        <span>Without water</span>
        <span style={{ textAlign: "right" }}>+ watered</span>
      </div>
      {days.map((d) => {
        const low = d.pctNoWater < 55;
        return (
          <div key={d.day} style={{ display: "grid", gridTemplateColumns: cols, gap: "0 10px", alignItems: "center", minHeight: 34, fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
            <span style={{ fontWeight: 600 }}>{d.day}</span>
            <span style={{ textAlign: "right", color: v("ink2") }}>{d.tempMax != null ? `${d.tempMax}°` : ""}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ position: "relative", flex: 1, height: 8, borderRadius: 4, background: v("sunk") }}>
                <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 4, width: `${d.pctNoWater}%`, background: low ? v("act") : v("water") }} />
                <span style={{ position: "absolute", left: "55%", top: -3, bottom: -3, width: 2, background: v("ink"), opacity: 0.6 }} />
              </span>
              <span style={{ width: 32, textAlign: "right", fontWeight: 600, color: low ? v("act") : v("ink") }}>{d.pctNoWater}%</span>
            </span>
            <span style={{ textAlign: "right", fontWeight: 600, color: v("water") }}>{d.pctWatered}%</span>
          </div>
        );
      })}
    </div>
  );
}

// ---- Collapsible soil + season sections ----------------------------------

function Collapsible({ label, summary, children }: { label: string; summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 44, width: "100%", border: 0, background: "transparent", padding: 0, color: v("ink"), cursor: "pointer", textAlign: "left" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Label>{label}</Label>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{summary}</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: "none", height: 32, padding: "0 10px 0 12px", borderRadius: 16, background: v("sunk"), fontSize: 12, fontWeight: 600 }}>
          {open ? "Hide" : "Details"}
          <ChevronDown size={16} strokeWidth={2.5} style={{ transform: open ? "rotate(180deg)" : "none" }} />
        </span>
      </button>
      {open && children}
    </>
  );
}

export function SoilCard({ soil }: { soil: Soil }) {
  return (
    <Collapsible label="Soil" summary={`${soil.texture} · ${soil.usableMm} mm usable`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontFamily: font.display, fontWeight: 600, fontSize: 28, lineHeight: 1 }}>{soil.texture}</span>
          <span style={{ fontSize: 13, color: v("ink2") }}>{soil.omPct}% organic matter</span>
        </div>
        <div style={{ display: "flex", gap: 2, height: 12, borderRadius: 6, overflow: "hidden" }}>
          <div style={{ flex: soil.sandPct, background: v("cons") }} />
          <div style={{ flex: soil.siltPct, background: v("brand"), opacity: 0.55 }} />
          <div style={{ flex: soil.clayPct, background: v("ink") }} />
        </div>
        <div style={{ display: "flex", gap: 2, fontSize: 11, color: v("ink2") }}>
          <span style={{ flex: soil.sandPct }}>Sand {soil.sandPct}%</span>
          <span style={{ flex: soil.siltPct }}>Silt {soil.siltPct}%</span>
          <span style={{ flex: soil.clayPct, whiteSpace: "nowrap", textAlign: "right" }}>Clay {soil.clayPct}%</span>
        </div>
        <div style={{ fontSize: 13, color: v("ink2"), lineHeight: 1.5 }}>{soil.note}</div>
      </div>
    </Collapsible>
  );
}

export function SeasonBalanceCard({ season }: { season: SeasonBalance }) {
  return (
    <Collapsible label="Season balance" summary={`${season.stressDays} stress days · ${season.irrigatedMm} mm irrigated`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <StatTile caption="rain (mm)" value={season.rainMm} background={v("waterSoft")} />
          <StatTile caption="irrigated (mm)" value={season.irrigatedMm} />
          <StatTile caption="crop use (mm)" value={season.cropUseMm} />
          <StatTile caption="drained (mm)" value={season.drainedMm} />
          <StatTile caption="stress days" value={season.stressDays} background={v("okSoft")} />
          <StatTile caption="crop days" value={season.cropDays} />
        </div>
      </div>
    </Collapsible>
  );
}
