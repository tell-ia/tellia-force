import { useState } from "react";
import type { ParcelReport } from "@tellia/shared";
import { getParcelReport } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { useTheme } from "../../theme/ThemeProvider";
import { font, radius, v } from "../../theme/tokens";
import { Label, SectionCard } from "../../components/ui/primitives";
import { RecommendationCard } from "../parcel/RecommendationCard";
import {
  BalanceLegend,
  CropStageTimeline,
  NextDaysTable,
  ReserveGauge,
  SeasonBalanceCard,
  SoilCard,
  WaterBalanceChart,
} from "../parcel/charts";

// Dev-only gallery: every chart/card rendered from a fixture, in the current
// theme. Reach it at #/gallery. Toggle light/dark to check both.
const FIXTURES: { id: number; label: string }[] = [
  { id: 101, label: "The Valley" },
  { id: 201, label: "North Slope" },
];

export function GalleryScreen() {
  const { theme, toggle } = useTheme();
  const [pid, setPid] = useState(101);
  const { data } = useAsync<ParcelReport>(() => getParcelReport(pid), [pid]);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16, padding: "16px 16px 28px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 30 }}>Widget gallery</span>
        <button type="button" onClick={toggle} style={{ height: 40, padding: "0 14px", borderRadius: radius.pill, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), fontWeight: 600, cursor: "pointer" }}>
          {theme === "dark" ? "Light" : "Dark"} mode
        </button>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {FIXTURES.map((f) => (
          <button key={f.id} type="button" onClick={() => setPid(f.id)} style={{ height: 36, padding: "0 14px", borderRadius: radius.pill, border: `1px solid ${pid === f.id ? v("brand") : v("line")}`, background: pid === f.id ? v("brand") : v("surface"), color: pid === f.id ? v("bg") : v("ink"), fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
            {f.label}
          </button>
        ))}
      </div>
      {!data && <div style={{ color: v("ink2") }}>Loading fixtures…</div>}
      {data && (
        <>
          <Wrap name="RecommendationCard"><RecommendationCard rec={data.recommendation} /></Wrap>
          <Wrap name="ReserveGauge">
            <SectionCard><ReserveGauge reserve={data.reserve} /></SectionCard>
          </Wrap>
          {data.series && (
            <Wrap name="WaterBalanceChart">
              <SectionCard><WaterBalanceChart series={data.series} reserve={data.reserve} /><BalanceLegend /></SectionCard>
            </Wrap>
          )}
          {data.cropStage && (
            <Wrap name="CropStageTimeline">
              <SectionCard><CropStageTimeline cropStage={data.cropStage} /></SectionCard>
            </Wrap>
          )}
          {data.nextDays && (
            <Wrap name="NextDaysTable">
              <SectionCard><NextDaysTable days={data.nextDays} /></SectionCard>
            </Wrap>
          )}
          {data.soil && <Wrap name="SoilCard"><SectionCard><SoilCard soil={data.soil} /></SectionCard></Wrap>}
          {data.seasonBalance && <Wrap name="SeasonBalanceCard"><SectionCard><SeasonBalanceCard season={data.seasonBalance} /></SectionCard></Wrap>}
        </>
      )}
    </div>
  );
}

function Wrap({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Label>{name}</Label>
      {children}
    </div>
  );
}
