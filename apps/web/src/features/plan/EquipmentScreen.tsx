import { ArrowLeft, Check, Minus, Plus, TriangleAlert } from "lucide-react";
import { REEL_GUN_CATALOG, haPerDay, reelGunModel } from "@tellia/shared";
import { useFarm } from "../../app/FarmContext";
import { useEquipment } from "../../app/EquipmentContext";
import { navigate } from "../../app/router";
import { font, radius, v } from "../../theme/tokens";
import { Label } from "../../components/ui/primitives";

const MAX_GUNS = 3;

export function EquipmentScreen() {
  const { farm } = useFarm();
  const { equipmentFor, setEquipment } = useEquipment();
  if (!farm) return null;
  const eq = equipmentFor(farm.id);

  const guns = eq.gunModelIds.map((id) => reelGunModel(id));
  const sumFlow = guns.reduce((s, g) => s + g.flowM3h, 0);
  const pumpOk = sumFlow <= eq.pumpM3h;

  const setModel = (i: number, id: string) =>
    setEquipment(farm.id, { ...eq, gunModelIds: eq.gunModelIds.map((m, j) => (j === i ? id : m)) });
  const addGun = () =>
    eq.gunModelIds.length < MAX_GUNS &&
    setEquipment(farm.id, { ...eq, gunModelIds: [...eq.gunModelIds, eq.gunModelIds[0] ?? "medium"] });
  const removeGun = () =>
    eq.gunModelIds.length > 1 &&
    setEquipment(farm.id, { ...eq, gunModelIds: eq.gunModelIds.slice(0, -1) });
  const bumpPump = (d: number) => setEquipment(farm.id, { ...eq, pumpM3h: Math.max(10, eq.pumpM3h + d) });
  const bumpMove = (d: number) => setEquipment(farm.id, { ...eq, moveMinutes: Math.max(15, eq.moveMinutes + d) });
  const moveLabel = eq.moveMinutes >= 60 ? `${(eq.moveMinutes / 60).toFixed(eq.moveMinutes % 60 ? 1 : 0)} h` : `${eq.moveMinutes} min`;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, padding: "12px 16px calc(28px + env(safe-area-inset-bottom))" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" onClick={() => navigate("plan")} aria-label="Back" style={{ width: 44, height: 44, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: v("ink"), borderRadius: 22, background: v("sunk"), border: 0, cursor: "pointer" }}>
          <ArrowLeft size={22} />
        </button>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <Label>Farm equipment</Label>
          <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 26 }}>Reel guns</span>
        </div>
      </div>

      {guns.map((g, i) => (
        <section key={i} style={{ background: v("surface"), border: `1px solid ${v("line")}`, borderRadius: radius.section, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 44, height: 44, flex: "none", borderRadius: 12, background: v("brand"), color: v("bg"), display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font.display, fontWeight: 700 }}>{i + 1}</span>
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
              <span style={{ fontWeight: 600, fontSize: 16 }}>Reel gun {i + 1}</span>
              <span style={{ fontSize: 13, color: v("ink2") }}>{g.brand} {g.name} · Ø{g.hoseMm} mm × {g.hoseLengthM} m</span>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            <Stat caption="Flow" value={`${g.flowM3h}`} unit="m³/h" />
            <Stat caption="Strip" value={`${g.stripWidthM}`} unit="m" />
            <Stat caption="Per day" value={haPerDay(g.flowM3h).toFixed(1)} unit="ha" />
          </div>
          <div role="radiogroup" aria-label="Model" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: v("ink2") }}>Model · typical values</span>
            {REEL_GUN_CATALOG.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={m.id === g.id} onClick={() => setModel(i, m.id)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 44, padding: "0 12px", borderRadius: 10, fontSize: 14, color: v("ink"), cursor: "pointer", textAlign: "left", background: m.id === g.id ? v("surface") : v("bg"), border: m.id === g.id ? `2px solid ${v("ink")}` : `1px solid ${v("line")}` }}>
                <span style={{ fontWeight: 600 }}>{m.label} · {m.name}</span>
                <span style={{ fontSize: 12, color: v("ink2") }}>{m.flowM3h} m³/h · {m.stripWidthM} m</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <div style={{ display: "flex", gap: 10 }}>
        {eq.gunModelIds.length < MAX_GUNS && (
          <button type="button" onClick={addGun} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 50, borderRadius: 14, border: `1.5px dashed ${v("line")}`, background: "transparent", color: v("ink"), fontWeight: 600, cursor: "pointer" }}><Plus size={18} />Add a reel gun</button>
        )}
        {eq.gunModelIds.length > 1 && (
          <button type="button" onClick={removeGun} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 50, borderRadius: 14, border: `1.5px dashed ${v("line")}`, background: "transparent", color: v("ink"), fontWeight: 600, cursor: "pointer" }}><Minus size={18} />Remove gun {eq.gunModelIds.length}</button>
        )}
      </div>

      <Label>Water source &amp; constraints</Label>
      <section style={{ background: v("surface"), border: `1px solid ${v("line")}`, borderRadius: radius.section, padding: "4px 16px" }}>
        <StepperRow title="Pump / borehole max" sub="All reel guns together" value={`${eq.pumpM3h} m³/h`} onDown={() => bumpPump(-10)} onUp={() => bumpPump(10)} border />
        <StepperRow title="Move between runs" sub="Unroll, set up, restart" value={moveLabel} onDown={() => bumpMove(-15)} onUp={() => bumpMove(15)} />
      </section>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", borderRadius: 12, padding: "12px 14px", background: pumpOk ? v("okSoft") : v("actSoft"), color: v("ink") }}>
        {pumpOk ? <Check size={18} style={{ flex: "none", marginTop: 2, color: v("brand") }} /> : <TriangleAlert size={18} style={{ flex: "none", marginTop: 2, color: v("act") }} />}
        <span style={{ fontSize: 13, lineHeight: 1.45 }}>
          {pumpOk
            ? `The reel gun${guns.length > 1 ? "s" : ""} need ${sumFlow} m³/h together, the pump gives ${eq.pumpM3h}. They can all run at once.`
            : `The reel guns need ${sumFlow} m³/h together, the pump gives only ${eq.pumpM3h}. The plan won't run them all at the same time.`}
        </span>
      </div>

      <button type="button" onClick={() => navigate("plan")} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 52, borderRadius: 14, border: 0, background: v("brand"), color: v("bg"), fontWeight: 600, fontSize: 15, cursor: "pointer" }}>See the irrigation plan →</button>
    </div>
  );
}

function Stat({ caption, value, unit }: { caption: string; value: string; unit: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, background: v("sunk"), borderRadius: 10, padding: "8px 10px" }}>
      <span style={{ fontSize: 11, color: v("ink2") }}>{caption}</span>
      <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 22, lineHeight: 1 }}>{value}<span style={{ fontSize: 13 }}> {unit}</span></span>
    </div>
  );
}

function StepperRow({ title, sub, value, onDown, onUp, border }: { title: string; sub: string; value: string; onDown: () => void; onUp: () => void; border?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 56, borderBottom: border ? `1px solid ${v("line")}` : 0 }}>
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
        <span style={{ fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 12, color: v("ink2") }}>{sub}</span>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button type="button" onClick={onDown} aria-label="Less" style={{ width: 44, height: 44, borderRadius: 22, border: `1px solid ${v("line")}`, background: v("bg"), color: v("ink"), fontSize: 20, cursor: "pointer" }}>−</button>
        <span style={{ minWidth: 78, textAlign: "center", fontFamily: font.display, fontWeight: 700, fontSize: 20 }}>{value}</span>
        <button type="button" onClick={onUp} aria-label="More" style={{ width: 44, height: 44, borderRadius: 22, border: `1px solid ${v("line")}`, background: v("bg"), color: v("ink"), fontSize: 20, cursor: "pointer" }}>+</button>
      </span>
    </div>
  );
}
