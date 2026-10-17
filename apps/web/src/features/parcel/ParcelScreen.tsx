import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { ParcelReport } from "@tellia/shared";
import { getParcelReport } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { useFarm } from "../../app/FarmContext";
import { navigate } from "../../app/router";
import { font, radius, v } from "../../theme/tokens";
import { DateChip, Label, SectionCard } from "../../components/ui/primitives";
import { RecommendationCard } from "./RecommendationCard";
import {
  BalanceLegend,
  CropStageTimeline,
  NextDaysTable,
  ReserveGauge,
  SeasonBalanceCard,
  SoilCard,
  WaterBalanceChart,
} from "./charts";

function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getDate()} ${d.toLocaleString("en", { month: "short" })}`;
}

export function ParcelScreen({ parcelId, anchor }: { parcelId: number; anchor?: string }) {
  const { farm } = useFarm();
  const balanceRef = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState(false);
  const { data, loading, error } = useAsync<ParcelReport>(() => getParcelReport(parcelId), [parcelId]);

  useEffect(() => {
    if (data && anchor === "balance") {
      const scroll = setTimeout(() => {
        balanceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        setHighlighted(true);
      }, 120);
      const fade = setTimeout(() => setHighlighted(false), 1800);
      return () => {
        clearTimeout(scroll);
        clearTimeout(fade);
      };
    }
  }, [data, anchor]);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16, padding: "12px 16px calc(28px + env(safe-area-inset-bottom))" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <button type="button" onClick={() => navigate("today")} aria-label="Back to Today" style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", color: v("ink"), borderRadius: 22, background: v("sunk"), border: 0, cursor: "pointer" }}>
          <ArrowLeft size={22} />
        </button>
        <DateChip>Wed 13 Jul 2022</DateChip>
      </div>

      {loading && <div aria-hidden="true" style={{ height: 280, borderRadius: radius.hero, background: v("sunk"), opacity: 0.6 }} />}
      {error && <div style={{ color: v("act") }}>Couldn't load this parcel: {error}</div>}

      {data && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 4px" }}>
            <div style={{ fontFamily: font.display, fontWeight: 700, fontSize: 46, lineHeight: 0.95, letterSpacing: "-0.01em" }}>{data.name}</div>
            <div style={{ fontSize: 14, color: v("ink2") }}>
              {data.cropName}
              {data.areaHa ? ` · ${data.areaHa} ha` : ""}
              {data.sownOn ? ` · sown ${fmtDay(data.sownOn)}` : ""}
              {farm ? ` · ${farm.name}` : ""}
            </div>
          </div>

          <RecommendationCard rec={data.recommendation} />

          <SectionCard style={{ gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Label>Soil water reserve</Label>
                <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 48, lineHeight: 0.95 }}>{data.reserve.availableMm}</span>
                  <span style={{ fontSize: 15, color: v("ink2") }}>of {data.reserve.capacityMm} mm</span>
                </span>
              </div>
              <span style={{ fontFamily: font.display, fontWeight: 600, fontSize: 26, color: v("water") }}>{data.reserve.pct}%</span>
            </div>
            <ReserveGauge reserve={data.reserve} />
            <div style={{ fontSize: 13, color: v("ink2"), lineHeight: 1.5 }}>
              Hatched: what the crop will use by {data.reserve.thresholdLabel} (≈ {data.reserve.usedByThresholdMm} mm). Below the line the crop closes its stomata and loses yield.
            </div>
          </SectionCard>

          {data.series && (
            <SectionCard id="balance" style={{ gap: 12, boxShadow: highlighted ? "0 0 0 4px var(--tf-waterSoft)" : "none", transition: "box-shadow 0.5s ease" }}>
              <div ref={balanceRef} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <Label>Water balance · {data.series.at(0)?.dayLabel}–{data.series.at(-1)?.dayLabel} Jul</Label>
                <span style={{ fontSize: 12, color: v("ink2") }}>mm</span>
              </div>
              <WaterBalanceChart series={data.series} reserve={data.reserve} plan={data.plan} />
              <BalanceLegend withPlan={!!data.plan} />
            </SectionCard>
          )}

          {data.cropStage && (
            <SectionCard style={{ gap: 14 }}>
              <CropStageTimeline cropStage={data.cropStage} />
            </SectionCard>
          )}

          {data.nextDays && (
            <SectionCard style={{ gap: 10 }}>
              <NextDaysTable days={data.nextDays} hasPlan={!!data.plan} />
              <div style={{ fontSize: 12, color: v("ink2"), lineHeight: 1.5 }}>
                Each bar: reserve from rain alone, then the recommended {data.plan ? "plan" : "watering"} on top — rain counts in both. Comfort threshold at the tick (55%).
              </div>
            </SectionCard>
          )}

          {data.soil && (
            <SectionCard>
              <SoilCard soil={data.soil} />
            </SectionCard>
          )}

          {data.seasonBalance && (
            <SectionCard style={{ gap: 14 }}>
              <SeasonBalanceCard season={data.seasonBalance} />
            </SectionCard>
          )}

          <div style={{ fontSize: 11, color: v("ink2"), lineHeight: 1.5, padding: "0 4px" }}>{data.method}</div>
        </>
      )}
    </div>
  );
}
