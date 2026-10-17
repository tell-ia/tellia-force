import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { ParcelReport } from "@tellia/shared";
import { getParcelReport } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { useFarm } from "../../app/FarmContext";
import { navigate } from "../../app/router";
import { font, v } from "../../theme/tokens";
import { InfoHint, Label, SectionCard } from "../../components/ui/primitives";
import { DateButton } from "../../components/DateSheet";
import { dayRange } from "../../lib/dates";
import { Loader } from "../../components/ui/Loader";
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

/** The "?" hint pinned to a card's top-right corner (the card must be position:relative). */
function CornerHint({ text }: { text: string }) {
  return (
    <span style={{ position: "absolute", top: 12, right: 12, zIndex: 5 }}>
      <InfoHint text={text} />
    </span>
  );
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
        <DateButton />
      </div>

      {loading && <Loader />}
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

          <SectionCard style={{ gap: 14, position: "relative" }}>
            <CornerHint text="The bar is the water the soil holds right now. The hatched part is what the crop will drink before the stress line — past that line it closes up and loses yield." />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10, paddingRight: 28 }}>
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
            <SectionCard id="balance" style={{ gap: 12, position: "relative", boxShadow: highlighted ? "0 0 0 4px var(--tf-waterSoft)" : "none", transition: "box-shadow 0.5s ease" }}>
              <CornerHint text="Bars show water added each day (rain in blue, irrigation, the plan). The line is the soil reserve over time — solid for the past, dashed for the forecast. The dotted red line is the stress threshold." />
              <div ref={balanceRef} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingRight: 28 }}>
                <Label>Water balance · {data.series.length ? dayRange(data.series[0]!.date, data.series.at(-1)!.date) : ""}</Label>
                <span style={{ fontSize: 12, color: v("ink2") }}>mm</span>
              </div>
              <WaterBalanceChart series={data.series} reserve={data.reserve} plan={data.plan} />
              <BalanceLegend withPlan={!!data.plan} />
            </SectionCard>
          )}

          {data.cropStage && (
            <SectionCard style={{ gap: 14, position: "relative" }}>
              <CornerHint text="The crop's growth stages across the season. Each segment's width is how long that stage lasts (in degree-days); the marker is where the crop is today." />
              <CropStageTimeline cropStage={data.cropStage} />
            </SectionCard>
          )}

          {data.nextDays && (
            <SectionCard style={{ gap: 10, position: "relative" }}>
              <CornerHint text="Each tank is the soil reserve at the end of the day with the plan, as % of usable water: water already in the soil (earlier waterings included), that day's rain, then that day's own watering. The dashed mark in the tank is the level without any watering; the dashed line is the comfort threshold." />
              <NextDaysTable days={data.nextDays} comfortPct={data.reserve.thresholdPct} />
              <div style={{ fontSize: 12, color: v("ink2"), lineHeight: 1.5 }}>
                Each tank is the reserve at the end of the day with the {data.plan ? "plan" : "advice"}: water already in the soil (earlier waterings included), that day's rain, then that day's own watering. The dashed mark is the level without any watering.
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
