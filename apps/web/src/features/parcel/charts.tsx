import { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import type { BalancePoint, CropTimeline, NextDay, RefillPlanSeries, Reserve, SeasonBalance, Soil } from "@tellia/shared";
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
  // Only label "Today %" when it won't collide with the comfort label (the % is
  // also in the card header). The fill edge marks today either way.
  const showToday = Math.abs(todayX - thresholdX) >= 72;
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
      <text x={thresholdX} y="11" textAnchor="middle" fill={v("ink")} fontSize="11" fontWeight={600}>Comfort {reserve.thresholdMm} mm</text>
      {showToday && (
        <text x={todayX} y="11" textAnchor="middle" fill={fill} fontSize="11" fontWeight={600}>Today {reserve.pct}%</text>
      )}
      <text x="0" y="70" fill={v("ink2")} fontSize="11">0 · stress zone</text>
      <text x={thresholdX} y="70" textAnchor="middle" fill={v("act")} fontSize="11" fontWeight={600}>{reserve.thresholdLabel}</text>
      <text x="326" y="70" textAnchor="end" fill={v("ink2")} fontSize="11">Full {cap}</text>
    </svg>
  );
}

// ---- Water balance chart --------------------------------------------------

export function WaterBalanceChart({ series, reserve, plan }: { series: BalancePoint[]; reserve: Reserve; plan?: RefillPlanSeries }) {
  const N = series.length;
  const cap = reserve.capacityMm;
  const dx = (312 - 30) / Math.max(1, N - 1);
  const xAt = (i: number) => 30 + i * dx;

  // Layout: a taller "in ↑ / used ↓" band above the divider, reserve below.
  const IN_BASE = 80; // divider between in (up) and used (down)
  const IN = 0.8; // px per mm for the in/used bars
  const USE = 1.5;
  const RES_TOP = 132; // y of the "full" (cap) line
  const RES_BOT = 222; // y of the 40 mm line
  const yRes = (mm: number) => RES_TOP + ((cap - mm) / (cap - 40)) * (RES_BOT - RES_TOP);
  const yThreshold = yRes(reserve.thresholdMm);

  const todayIndex = series.reduce((acc, p, i) => (p.forecast ? acc : i), 0);
  const firstFc = series.findIndex((p) => p.forecast);
  const fcX = firstFc >= 0 ? xAt(firstFc) - dx / 2 : 326;

  const resPt = (i: number) => `${xAt(i).toFixed(1)},${yRes(series[i]!.reserveMm).toFixed(1)}`;
  const pastPts = series.map((p, i) => (p.forecast ? null : resPt(i))).filter(Boolean).join(" ");
  const fcPts = [resPt(todayIndex), ...series.map((p, i) => (p.forecast ? resPt(i) : null)).filter(Boolean)].join(" ");
  const areaPts = `${xAt(0).toFixed(1)},${RES_BOT} ${series.map((_, i) => resPt(i)).join(" ")} ${xAt(N - 1).toFixed(1)},${RES_BOT}`;

  const today = series[todayIndex]!;

  // Plan overlay: the reserve climbing back + the scheduled passes.
  const planByDate = plan ? new Map(plan.series.map((p) => [p.date, p.reserveMm])) : null;
  const passByDate = plan ? new Map(plan.passes.map((p) => [p.date, p.grossMm])) : null;
  const planPts = planByDate
    ? series
        .map((p, i) =>
          i >= todayIndex
            ? `${xAt(i).toFixed(1)},${yRes(planByDate.get(p.date) ?? p.reserveMm).toFixed(1)}`
            : null,
        )
        .filter(Boolean)
        .join(" ")
    : "";

  return (
    <svg viewBox="0 0 326 248" width="100%" role="img" aria-label={`Daily rain, irrigation and crop use with the soil-reserve line; reserve ${reserve.availableMm} mm today, comfort threshold ${reserve.thresholdMm} mm`} style={{ display: "block", marginLeft: -4, fontFamily: font.body }}>
      <defs>
        <pattern id="tfFc" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke={v("ink2")} strokeWidth={1} opacity={0.22} />
        </pattern>
      </defs>
      {firstFc >= 0 && <rect x={fcX} y="0" width={326 - fcX} height={RES_BOT + 2} fill="url(#tfFc)" />}
      {firstFc >= 0 && <text x={fcX + 5} y="12" fill={v("ink2")} fontSize="10" fontWeight={600} letterSpacing="0.08em">FORECAST</text>}
      <text x="0" y="12" fill={v("ink2")} fontSize="10">In ↑ / used ↓</text>
      <line x1="22" y1={IN_BASE} x2="320" y2={IN_BASE} stroke={v("line")} />

      {series.map((p, i) => {
        const rainH = p.rain * IN;
        const irrigH = p.irrigation * IN;
        const planMm = passByDate?.get(p.date) ?? 0;
        const planH = planMm * IN;
        const useH = p.cropUse * USE;
        const x = xAt(i) - 4.5;
        const topMm = planMm || p.irrigation;
        const topH = Math.max(irrigH, planH);
        return (
          <g key={`bar${i}`}>
            {rainH > 0 && <rect x={x} y={IN_BASE - rainH} width="9" height={rainH} rx="2" fill={v("rain")} />}
            {irrigH > 0 && <rect x={x} y={IN_BASE - rainH - irrigH} width="9" height={irrigH} rx="2" fill={v("water")} />}
            {planH > 0 && <rect x={x} y={IN_BASE - rainH - planH} width="9" height={planH} rx="2" fill={v("brand")} opacity={0.9} />}
            {topMm > 0 && (
              <text x={xAt(i)} y={IN_BASE - rainH - topH - 3} textAnchor="middle" fill={v("ink")} fontSize="9" fontWeight={600}>{Math.round(topMm)}</text>
            )}
            <rect x={x} y={IN_BASE + 2} width="9" height={useH} rx="2" fill={v("cons")} opacity={p.forecast ? 0.6 : 1} />
          </g>
        );
      })}

      <text x="0" y={RES_TOP - 8} fill={v("ink2")} fontSize="10">Soil reserve</text>
      <text x="18" y={RES_TOP + 3} textAnchor="end" fill={v("ink2")} fontSize="10">{cap}</text>
      <text x="18" y={RES_BOT + 3} textAnchor="end" fill={v("ink2")} fontSize="10">40</text>
      <line x1="22" y1={RES_TOP} x2="320" y2={RES_TOP} stroke={v("line")} strokeDasharray="2 3" />
      <line x1="22" y1={RES_BOT} x2="320" y2={RES_BOT} stroke={v("line")} />
      <polygon points={areaPts} fill={v("waterSoft")} />
      <line x1="22" y1={yThreshold} x2="320" y2={yThreshold} stroke={v("act")} strokeWidth={1.5} strokeDasharray="5 3" />
      <text x="18" y={yThreshold + 3} textAnchor="end" fill={v("act")} fontSize="10" fontWeight={600}>{reserve.thresholdMm}</text>
      <polyline points={pastPts} fill="none" stroke={v("water")} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={fcPts} fill="none" stroke={v("water")} strokeWidth={2.5} strokeDasharray="2 4" strokeLinecap="round" />
      {plan && <polyline points={planPts} fill="none" stroke={v("brand")} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
      <line x1={xAt(todayIndex)} y1={IN_BASE + 6} x2={xAt(todayIndex)} y2={RES_BOT} stroke={v("ink")} opacity={0.35} />
      <circle cx={xAt(todayIndex)} cy={yRes(today.reserveMm)} r="5" fill={v("water")} stroke={v("surface")} strokeWidth={2.5} />
      <text x={xAt(todayIndex) - 6} y={yRes(today.reserveMm) - 6} textAnchor="end" fill={v("ink")} fontSize="11" fontWeight={600}>{Math.round(today.reserveMm)}</text>

      {series.map((p, i) =>
        i % 2 === 0 ? (
          <text key={`lab${i}`} x={xAt(i)} y="242" textAnchor="middle" fill={i === todayIndex ? v("ink") : v("ink2")} fontSize={i === todayIndex ? 11 : 10} fontWeight={i === todayIndex ? 700 : 400}>{p.dayLabel}</text>
        ) : null,
      )}
    </svg>
  );
}

export function BalanceLegend({ withPlan }: { withPlan?: boolean }) {
  const item = (swatch: React.ReactNode, label: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{swatch}{label}</span>
  );
  const sq = (c: string) => <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: "inline-block" }} />;
  const line = (c: string) => <span style={{ width: 16, height: 3, borderRadius: 2, background: c, display: "inline-block" }} />;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", fontSize: 12, color: v("ink2") }}>
      {item(sq(v("rain")), "Rain")}
      {item(sq(v("water")), "Irrigation")}
      {item(sq(v("cons")), "Crop use")}
      {item(line(v("water")), withPlan ? "Reserve, no water" : "Reserve")}
      {withPlan && item(line(v("brand")), "With the plan")}
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

export function NextDaysTable({ days, hasPlan }: { days: NextDay[]; hasPlan?: boolean }) {
  const cols = "46px minmax(0, 1fr) 88px";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Label>Next 5 days</Label>
        <span style={{ fontSize: 12, color: v("ink2") }}>% of usable reserve</span>
      </div>
      {/* legend — same colours as the water-balance chart */}
      <div style={{ display: "flex", gap: 14, fontSize: 11, color: v("ink2") }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: v("rain") }} />rain only
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: v("brand") }} />+ {hasPlan ? "the plan" : "watering"}
        </span>
      </div>
      {days.map((d) => {
        const low = d.pctWatered < 55;
        const added = Math.max(0, d.pctWatered - d.pctNoWater);
        return (
          <div key={d.day} style={{ display: "grid", gridTemplateColumns: cols, gap: "0 10px", alignItems: "center", minHeight: 34, fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
            <span style={{ fontWeight: 600 }}>{d.day}</span>
            <span style={{ position: "relative", height: 10, borderRadius: 5, background: v("sunk") }}>
              {/* reserve from rain alone (blue, like the chart's rain) */}
              <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: added > 0 ? "5px 0 0 5px" : 5, width: `${d.pctNoWater}%`, background: v("rain") }} />
              {/* what the recommended irrigation adds (green, like the plan), capping the fill */}
              <span style={{ position: "absolute", left: `${d.pctNoWater}%`, top: 0, bottom: 0, borderRadius: d.pctNoWater > 0 ? "0 5px 5px 0" : 5, width: `${added}%`, background: v("brand") }} />
              {/* comfort threshold */}
              <span style={{ position: "absolute", left: "55%", top: -3, bottom: -3, width: 2, background: v("ink"), opacity: 0.6 }} />
            </span>
            <span style={{ textAlign: "right", fontWeight: 600 }}>
              <span style={{ color: v("rain") }}>{d.pctNoWater}</span>
              <span style={{ color: v("ink2") }}>→</span>
              <span style={{ color: low ? v("act") : v("brand") }}>{d.pctWatered}%</span>
            </span>
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
