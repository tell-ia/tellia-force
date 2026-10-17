import { useState } from "react";
import { Check, Send } from "lucide-react";
import type { FarmToday } from "@tellia/shared";
import { getFarmToday } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { useFarm } from "../../app/FarmContext";
import { navigate } from "../../app/router";
import { font, radius, v } from "../../theme/tokens";
import { hero } from "../../theme/tokens";
import { Label } from "../../components/ui/primitives";
import { useDemoDate } from "../../app/DateContext";
import { formatDay } from "../../lib/dates";

export function AdminScreen() {
  const { farm, farms, setFarm } = useFarm();
  const { today } = useDemoDate();
  const [fired, setFired] = useState(false);
  const { data } = useAsync<FarmToday | null>(
    () => (farm ? getFarmToday(farm) : Promise.resolve(null)),
    [farm?.id],
  );

  if (!farm) return null;
  const action = data?.parcels.find((p) => p.status === "action");
  const topAction = action ? `${action.badgeLabel} — ${action.name}${action.netMm ? ` · ${action.netMm} mm` : ""}` : "All fields on track";

  const steps = [
    { title: `${farm.parcelCount} parcel reports computed`, sub: "FAO-56 balance · AgERA5 weather", time: "07:00:02" },
    { title: "Brief written · top action", sub: topAction, time: "07:00:04" },
    { title: `Delivered to ${farm.farmerName}`, sub: "In-app chat · push notification", time: "07:00:05" },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16, padding: "16px 16px calc(28px + env(safe-area-inset-bottom))" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <Label>Admin</Label>
          <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 34 }}>Demo control</span>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, background: v("sunk"), borderRadius: radius.pill, padding: "5px 11px" }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: v("brand") }} />Stage mode
        </span>
      </div>

      <section style={{ background: v("surface"), border: `1px solid ${v("line")}`, borderRadius: radius.section, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        <Label>Scenario</Label>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${farms.length}, minmax(0, 1fr))`, gap: 4, background: v("sunk"), borderRadius: radius.tile, padding: 3 }}>
          {farms.map((f) => {
            const on = f.id === farm.id;
            return (
              <button key={f.id} type="button" aria-pressed={on} onClick={() => { setFarm(f); setFired(false); }} style={{ height: 44, border: 0, borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: "pointer", background: on ? v("surface") : "transparent", color: on ? v("ink") : v("ink2"), boxShadow: on ? "0 1px 2px rgba(15, 24, 19, 0.12)" : "none" }}>{f.name}</button>
            );
          })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <Field caption="Demo date" value={formatDay(today)} />
          <Field caption="Source" value={farm.code} />
        </div>
      </section>

      <button type="button" onClick={() => setFired(true)} style={{ position: "relative", overflow: "hidden", height: 120, border: 0, borderRadius: radius.hero, background: hero.bg, color: hero.ink, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <img src={hero.texture} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        <span style={{ position: "relative", display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ width: 52, height: 52, borderRadius: 26, background: hero.ink, color: "#234534", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Send size={24} />
          </span>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.1 }}>
            <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 30 }}>{fired ? "Brief sent" : "Send morning brief"}</span>
            <span style={{ fontSize: 13, color: hero.ink2 }}>Runs get_parcel_report for every parcel</span>
          </span>
        </span>
      </button>

      {fired && (
        <section role="status" style={{ background: v("surface"), border: `1px solid ${v("line")}`, borderRadius: radius.section, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <Label>Run log</Label>
          {steps.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ width: 22, height: 22, flex: "none", borderRadius: 11, background: v("okSoft"), color: v("brand"), display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Check size={13} strokeWidth={3} />
              </span>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{s.title}</span>
                <span style={{ fontSize: 12, color: v("ink2") }}>{s.sub}</span>
              </span>
              <span style={{ fontSize: 12, color: v("ink2"), fontVariantNumeric: "tabular-nums" }}>{s.time}</span>
            </div>
          ))}
        </section>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: "auto" }}>
        <button type="button" onClick={() => setFired(false)} style={{ height: 50, borderRadius: radius.card, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), fontWeight: 600, cursor: "pointer" }}>Reset demo</button>
        <button type="button" onClick={() => navigate("chat")} style={{ height: 50, borderRadius: radius.card, border: 0, background: v("brand"), color: v("bg"), fontWeight: 600, cursor: "pointer" }}>Open chat</button>
      </div>
    </div>
  );
}

function Field({ caption, value }: { caption: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, background: v("sunk"), borderRadius: radius.tile, padding: "10px 12px" }}>
      <span style={{ fontSize: 11, color: v("ink2") }}>{caption}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}
