import { ChevronDown, Droplet, Sun } from "lucide-react";
import { useState } from "react";
import type { FarmToday, ParcelSummary } from "@tellia/shared";
import { getFarmToday } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { farmAccent, useFarm } from "../../app/FarmContext";
import { navigate } from "../../app/router";
import { font, radius, v } from "../../theme/tokens";
import { Label, StatusPill } from "../../components/ui/primitives";
import { DateButton } from "../../components/DateSheet";
import { Loader } from "../../components/ui/Loader";
import { PersonaSheet } from "./PersonaSheet";

export function TodayScreen() {
  const { farm, farms } = useFarm();
  const [sheetOpen, setSheetOpen] = useState(false);
  const { data, loading } = useAsync<FarmToday | null>(
    () => (farm ? getFarmToday(farm) : Promise.resolve(null)),
    [farm?.id],
  );

  if (!farm) return null;
  const accent = farmAccent(farm, farms);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "16px 20px 8px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label={`Switch farm: ${farm.name}`}
          style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 48, border: 0, background: "transparent", padding: 0, color: v("ink"), cursor: "pointer", textAlign: "left" }}
        >
          <span style={{ width: 40, height: 40, borderRadius: 20, background: v(accent), color: v("bg"), display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font.display, fontWeight: 700, fontSize: 17, letterSpacing: "0.02em" }}>
            {farm.initials}
          </span>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: 600, fontSize: 16 }}>
              {farm.name}
              <ChevronDown size={16} />
            </span>
            <span style={{ fontSize: 12, color: v("ink2") }}>
              {farm.region}
              {farm.parcelCount ? ` · ${farm.parcelCount} parcels` : ""}
            </span>
          </span>
        </button>
        <DateButton />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 20px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
        {loading || !data ? (
          <Loader />
        ) : (
          <>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontFamily: font.display, fontWeight: 600, fontSize: 40, lineHeight: 0.98, letterSpacing: "-0.01em", textWrap: "balance" }}>
            {data?.greeting ?? farm.name}
          </div>
          <div style={{ fontSize: 14, color: v("ink2") }}>{data?.weatherNote ?? " "}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Label>Today's actions</Label>
          {data.parcels.map((p) =>
            p.status === "action" ? <ActionCard key={p.id} p={p} /> : <ParcelRow key={p.id} p={p} />,
          )}
        </div>

        {data?.alert && (
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", background: v("sunk"), borderRadius: radius.card, padding: "14px 16px" }}>
            <Sun size={22} strokeWidth={1.75} style={{ flex: "none", marginTop: 1 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 13 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{data.alert.title}</span>
              <span style={{ color: v("ink2") }}>{data.alert.detail}</span>
            </div>
          </div>
        )}
          </>
        )}
      </div>

      {sheetOpen && <PersonaSheet onClose={() => setSheetOpen(false)} />}
    </div>
  );
}

function ActionCard({ p }: { p: ParcelSummary }) {
  return (
    <button
      type="button"
      onClick={() => navigate(`parcel/${p.id}`)}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        textAlign: "left",
        color: v("ink"),
        background: v("surface"),
        border: `1.5px solid ${v("act")}`,
        borderRadius: radius.card,
        padding: 16,
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontFamily: font.display, fontWeight: 600, fontSize: 26, lineHeight: 1 }}>{p.name}</span>
          <span style={{ fontSize: 13, color: v("ink2") }}>
            {p.cropName} · {p.areaHa} ha{p.stageLabel ? ` · ${p.stageLabel}` : ""}
          </span>
        </div>
        <StatusPill tone="action" label={p.badgeLabel} icon={<Droplet size={12} strokeWidth={2.5} />} />
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 52, lineHeight: 0.9, color: v("act") }}>{p.grossMm ?? p.netMm}</span>
          <span style={{ fontFamily: font.display, fontWeight: 600, fontSize: 22, color: v("act") }}>mm</span>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, paddingBottom: 4 }}>
          <div style={{ position: "relative", height: 10, borderRadius: 5, background: v("sunk") }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${p.reservePct ?? 0}%`, borderRadius: 5, background: v("water") }} />
            <div style={{ position: "absolute", left: "55%", top: -4, bottom: -4, width: 2, background: v("ink") }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: v("ink2"), fontVariantNumeric: "tabular-nums" }}>
            <span>Soil water {p.reservePct}%</span>
            <span>{p.thresholdLabel}</span>
          </div>
        </div>
      </div>
      {p.refillNote && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: v("act"), fontWeight: 600 }}>
          <span style={{ fontSize: 14 }}>↻</span>
          {p.grossMm ?? p.netMm} mm now, {p.refillNote}
        </div>
      )}
    </button>
  );
}

function ParcelRow({ p }: { p: ParcelSummary }) {
  return (
    <button
      type="button"
      onClick={() => navigate(`parcel/${p.id}`)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        minHeight: 64,
        width: "100%",
        textAlign: "left",
        boxSizing: "border-box",
        color: v("ink"),
        background: v("surface"),
        border: `1px solid ${v("line")}`,
        borderRadius: radius.card,
        padding: "12px 16px",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontFamily: font.display, fontWeight: 600, fontSize: 21, lineHeight: 1.05 }}>{p.name}</span>
        <span style={{ fontSize: 13, color: v("ink2") }}>{p.cropName}{p.stageLabel ? ` · ${p.stageLabel}` : ""}</span>
      </div>
      <StatusPill tone={p.status === "ok" ? "watch" : "ok"} label={p.badgeLabel} />
    </button>
  );
}
