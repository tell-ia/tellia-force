import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { IrrigationRecord, ParcelReport } from "@tellia/shared";
import { deleteIrrigation, listIrrigations, parcelReportQuery } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { useQuery } from "../../lib/useQuery";
import { useFarm } from "../../app/FarmContext";
import { useDemoDate } from "../../app/DateContext";
import { useFarmPlan, useFieldOutcome } from "../../app/FarmPlanContext";
import { todayWater, type TodayWater } from "../../lib/mappers/farmPlan";
import { navigate } from "../../app/router";
import { font, v } from "../../theme/tokens";
import { InfoHint, Label, SectionCard } from "../../components/ui/primitives";
import { DateButton } from "../../components/DateSheet";
import { dayRange } from "../../lib/dates";
import { reserveDay, wateredOnMm } from "../../lib/mappers/parcel";
import { Loader } from "../../components/ui/Loader";
import { RecommendationCard } from "./RecommendationCard";
import { IrrigationLog } from "./IrrigationLog";
import {
  BalanceLegend,
  CropStageTimeline,
  NextDaysTable,
  ReserveDayGauge,
  ReserveGauge,
  SeasonBalanceCard,
  SoilCard,
  WaterBalanceChart,
} from "./charts";

function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getDate()} ${d.toLocaleString("en", { month: "short" })}`;
}

/** "half" for 0.5: the part of the field the gun covers today, in words. */
function shareWords(share: number): string {
  if (Math.abs(share - 0.5) < 0.05) return "half";
  if (Math.abs(share - 1 / 3) < 0.04) return "a third of";
  if (Math.abs(share - 2 / 3) < 0.04) return "two thirds of";
  if (Math.abs(share - 0.25) < 0.04) return "a quarter of";
  if (Math.abs(share - 0.75) < 0.04) return "three quarters of";
  return `${Math.round(share * 100)} % of`;
}

/** A legend item: a colour (or the crop's hatch) and a short label. */
function Swatch({ color, hatched, label }: { color?: string; hatched?: boolean; label: string }) {
  const bg = hatched ? `repeating-linear-gradient(45deg, ${v("ink")} 0 1.5px, ${v("sunk")} 1.5px 4px)` : color;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
      <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 2, background: bg }} />
      {label}
    </span>
  );
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
  // After a watering is deleted the report (its advice counts past waterings) reloads in place
  // (deleteIrrigation drops it from the cache; no full-page loader, no new anchor scroll; a
  // failed reload keeps the page), and `version` reloads the log.
  const [version, setVersion] = useState(0);
  const { today } = useDemoDate();
  const { data, loading, error } = useQuery<ParcelReport>(parcelReportQuery(parcelId, today));
  const outcome = useFieldOutcome(parcelId); // the field's forecast under the farm rotation plan
  const { plan: farmPlan } = useFarmPlan();
  const log = useAsync<IrrigationRecord[]>(() => listIrrigations(parcelId), [parcelId, version]);
  const removeWatering = async (operationId: number) => {
    await deleteIrrigation(operationId);
    setVersion((n) => n + 1);
  };
  const logRef = useRef<HTMLDivElement>(null);

  // Today's water on top of the reserve, as the chart counts it: the rotation's runs on this
  // field today (else the field's own plan, if it waters today). Field-average mm.
  let water: TodayWater | null = null;
  if (data && data.id === parcelId) {
    const eff = data.recommendation.efficiency || 1;
    const ownPass = data.plan?.passes.find((p) => p.date === data.asOf);
    water = outcome
      ? todayWater(farmPlan?.runs.filter((r) => r.fieldId === parcelId) ?? [], eff)
      : ownPass
        ? todayWater([{ passIndex: 0, startHour: 8, endHour: 18, grossMm: ownPass.grossMm }], eff)
        : null;
  }
  // Tonight's reserve and how it gets there, from the series the water-balance chart plots
  // (the rotation's when there is a plan), so the card and the chart show the same value.
  const daySeries = outcome?.series?.length ? outcome.series : data?.series;
  const day = data && data.id === parcelId && daySeries ? reserveDay(daySeries, data.asOf, data.reserve.availableMm) : null;

  // "See the log" (#/parcel/:id#log) lands on the irrigation log (once per parcel, not on a reload).
  useEffect(() => {
    if (data && anchor === "log") {
      const scroll = setTimeout(() => logRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
      return () => clearTimeout(scroll);
    }
  }, [data?.id, anchor]);

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
  }, [data?.id, anchor]);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16, padding: "12px 16px calc(28px + env(safe-area-inset-bottom))" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <button type="button" onClick={() => navigate("today")} aria-label="Back to Today" style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", color: v("ink"), borderRadius: 22, background: v("sunk"), border: 0, cursor: "pointer" }}>
          <ArrowLeft size={22} />
        </button>
        <DateButton />
      </div>

      {loading && data?.id !== parcelId && <Loader />}
      {error && <div style={{ color: v("act") }}>Couldn't load this parcel: {error}</div>}

      {data && data.id === parcelId && (
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

          <RecommendationCard rec={data.recommendation} wateredTodayMm={wateredOnMm(log.data ?? [], data.asOf)} />

          <SectionCard style={{ gap: 14, position: "relative" }}>
            {day ? (
              <>
                <CornerHint text="Tonight's soil water, the same value as the chart's dot for today: this morning's reserve, plus what the gun and rain add today, minus what the crop drinks (hatched). Below the comfort line the crop closes its stomata and loses yield." />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10, paddingRight: 28 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <Label>Soil water · tonight</Label>
                    <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 48, lineHeight: 0.95 }}>{day.tonightMm}</span>
                      <span style={{ fontSize: 15, color: v("ink2") }}>of {data.reserve.capacityMm} mm</span>
                    </span>
                  </div>
                  <span style={{ fontFamily: font.display, fontWeight: 600, fontSize: 26, color: v("water") }}>{Math.round((day.tonightMm / data.reserve.capacityMm) * 100)}%</span>
                </div>
                <ReserveDayGauge reserve={data.reserve} day={day} />
                {/* Short legend: the bar's parts, adding up to tonight. */}
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px", fontSize: 13, color: v("ink2") }}>
                  <Swatch color={day.tonightMm < data.reserve.thresholdMm ? v("act") : v("brand")} label={`${day.morningMm} morning`} />
                  {day.gunMm > 0 && <Swatch color={v("water")} label={`+${day.gunMm} gun`} />}
                  {day.rainMm > 0 && <Swatch color={v("rain")} label={`+${day.rainMm} rain`} />}
                  {day.cropMm > 0 && <Swatch hatched label={`−${day.cropMm} crop`} />}
                  <b style={{ color: v("ink") }}>= {day.tonightMm} tonight</b>
                </div>
                {water && (
                  <div style={{ fontSize: 12, color: v("ink2"), lineHeight: 1.5 }}>
                    Gun: {water.stripMm} mm on {water.share >= 0.95 ? "the whole field" : `${shareWords(water.share)} the field`}
                    {water.lostMm > 0 ? ` · ${water.lostMm} mm lost to wind` : ""}
                  </div>
                )}
              </>
            ) : (
              <>
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
              </>
            )}
          </SectionCard>

          {(() => {
            // Forecast follows the farm's reel-gun rotation when a plan exists (so it
            // dips if this field is watered late); else the field's own ideal balance.
            const planned = outcome?.series?.length ? outcome.series : null;
            const series = planned ?? data.series;
            if (!series) return null;
            return (
              <SectionCard id="balance" style={{ gap: 12, position: "relative", boxShadow: highlighted ? "0 0 0 4px var(--tf-waterSoft)" : "none", transition: "box-shadow 0.5s ease" }}>
                <CornerHint text="Bars show water added each day (rain in blue, irrigation). The line is the soil reserve over time — solid for the past, dashed for the forecast. The dotted red line is the stress threshold." />
                <div ref={balanceRef} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingRight: 28 }}>
                  <Label>Water balance · {series.length ? dayRange(series[0]!.date, series.at(-1)!.date) : ""}</Label>
                  <span style={{ fontSize: 12, color: v("ink2") }}>mm</span>
                </div>
                <WaterBalanceChart series={series} reserve={data.reserve} plan={planned ? undefined : data.plan} />
                <BalanceLegend withPlan={!planned && !!data.plan} />
                {planned && (
                  <span style={{ fontSize: 11, color: outcome?.late ? v("act") : v("ink2"), lineHeight: 1.5 }}>
                    {outcome?.late
                      ? "Follows the reel-gun rotation: this field is watered late, so the reserve dips below comfort before the gun arrives."
                      : "Follows the reel-gun rotation plan."}
                  </span>
                )}
              </SectionCard>
            );
          })()}

          <SectionCard id="log" style={{ gap: 10 }}>
            <div ref={logRef} />
            <IrrigationLog records={log.data} loading={log.loading} error={log.error} onLog={() => navigate(`log/${parcelId}`)} onDelete={removeWatering} />
          </SectionCard>

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
