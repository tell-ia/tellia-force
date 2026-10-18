import { useState, type CSSProperties } from "react";
import { ArrowLeft, Check, TriangleAlert } from "lucide-react";
import { type FarmEquipment, type FarmIrrigationPlan, type FarmPlanRun } from "@tellia/shared";
import { buildFarmPlan } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { useFarm } from "../../app/FarmContext";
import { useEquipment } from "../../app/EquipmentContext";
import { navigate } from "../../app/router";
import { font, radius, v } from "../../theme/tokens";
import { Label } from "../../components/ui/primitives";
import { Loader } from "../../components/ui/Loader";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmtH = (asOf: string, h: number) => {
  const day = Math.floor(h / 24);
  const hh = Math.floor(h % 24);
  const d = new Date(`${addDays(asOf, day)}T00:00:00Z`);
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${String(hh).padStart(2, "0")}:00`;
};

/** For each run, the field the gun must move FROM to start it (null if the gun stays on
 *  the same field or this is its first run). The gun can't be two places at once, so a
 *  move is a real task between runs. */
function movesBefore(plan: FarmIrrigationPlan): Map<FarmPlanRun, string> {
  const map = new Map<FarmPlanRun, string>();
  const byGun = new Map<number, FarmPlanRun[]>();
  for (const r of plan.runs) (byGun.get(r.gunIndex) ?? byGun.set(r.gunIndex, []).get(r.gunIndex)!).push(r);
  for (const runs of byGun.values()) {
    runs.sort((a, b) => a.startHour - b.startHour);
    for (let i = 1; i < runs.length; i++) {
      if (runs[i]!.fieldName !== runs[i - 1]!.fieldName) map.set(runs[i]!, runs[i - 1]!.fieldName);
    }
  }
  return map;
}

/** "Back to comfort in …" for a gun-count option. `atBest` = adding guns can't recover
 *  more fields, so the limit is the fields' depletion, not the gun count. */
function comfortLabel(plan: FarmIrrigationPlan, atBest: boolean): string {
  if (plan.feasible && (plan.comfortInDays ?? 0) === 0) return "Already above comfort — nothing runs late";
  if (plan.comfortInDays === null)
    return atBest
      ? "Even a full fleet can't out-run these fields' water use — keep the rotation going"
      : "Can't out-run the crop's water use — add a reel gun";
  const cy = plan.cyclesToComfort ?? 0;
  return `Projected back to comfort in ~${plan.comfortInDays} day${plan.comfortInDays === 1 ? "" : "s"} · ${cy} rotation${cy === 1 ? "" : "s"}`;
}

export function FarmPlanScreen() {
  const { farm } = useFarm();
  const { equipmentFor } = useEquipment();
  const base = farm ? equipmentFor(farm.id) : null;
  const actualCount = base?.gunModelIds.length ?? 1;
  const [gunOverride, setGunOverride] = useState<number | null>(null);
  const count = gunOverride ?? actualCount;

  const equipment: FarmEquipment | null = base
    ? { ...base, gunModelIds: Array.from({ length: count }, (_, i) => base.gunModelIds[i] ?? base.gunModelIds[0] ?? "medium") }
    : null;

  const { data: plan, loading } = useAsync<FarmIrrigationPlan | null>(
    () => (farm && equipment ? buildFarmPlan(farm, equipment) : Promise.resolve(null)),
    [farm?.id, count],
  );
  const setGunCount = (n: number) => setGunOverride(n);
  const gunCount = count;
  // Two gun-count choices: what the farm has now, and what we suggest for a steady,
  // un-stressed rotation (min guns so no field dips, without over-buying).
  const suggested = plan?.suggestedGuns ?? actualCount;
  const options = [...new Set([actualCount, suggested])].sort((a, b) => a - b);
  const atBest = gunCount >= suggested; // more guns wouldn't recover more fields

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, padding: "12px 16px calc(28px + env(safe-area-inset-bottom))" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" onClick={() => navigate("today")} aria-label="Back to Today" style={{ width: 44, height: 44, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: v("ink"), borderRadius: 22, background: v("sunk"), border: 0, cursor: "pointer" }}>
          <ArrowLeft size={22} />
        </button>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <Label>Irrigation plan</Label>
          <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 26 }}>Reel-gun rotation</span>
        </div>
        <button type="button" onClick={() => navigate("fields")} style={{ height: 40, padding: "0 10px", borderRadius: 20, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Fields</button>
        <button type="button" onClick={() => navigate("equipment")} style={{ height: 40, padding: "0 10px", borderRadius: 20, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Equipment</button>
      </div>

      {/* gun count: farm's actual count vs. the suggested steady-rotation count */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13, color: v("ink2") }}>Reel guns</span>
        <div role="group" aria-label="Reel guns" style={{ display: "grid", gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`, gap: 8 }}>
          {options.map((n) => {
            const on = n === gunCount;
            const tag = n === actualCount ? "On the farm" : n === suggested ? "Suggested" : null;
            return (
              <button key={n} type="button" aria-pressed={on} onClick={() => setGunCount(n)} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "9px 12px", border: `1.5px solid ${on ? v("ink") : v("line")}`, borderRadius: 12, cursor: "pointer", background: on ? v("surface") : "transparent", boxShadow: on ? "0 1px 2px rgba(15,24,19,0.12)" : "none" }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: v("ink") }}>{n} gun{n > 1 ? "s" : ""}</span>
                {tag && <span style={{ fontSize: 11, fontWeight: 600, color: n === suggested && n !== actualCount ? v("brand") : v("ink2") }}>{tag}</span>}
              </button>
            );
          })}
        </div>
        {loading && !plan
          ? <span style={{ fontSize: 11, color: v("ink2"), fontWeight: 600 }}>Finding the best gun count…</span>
          : !loading && plan && options.length === 1 && <span style={{ fontSize: 11, color: v("brand"), fontWeight: 600 }}>Your {actualCount} gun{actualCount > 1 ? "s are" : " is"} the right number for a steady rotation.</span>}
      </div>

      {loading && <Loader />}
      {!loading && plan && (
        plan.runs.length === 0 ? (
          <div style={{ background: v("surface"), border: `1px solid ${v("line")}`, borderRadius: radius.section, padding: 16, color: v("ink2"), fontSize: 14 }}>
            No field needs watering in the window — nothing to schedule.
          </div>
        ) : (
          <>
            {/* alert */}
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", borderRadius: 12, padding: "12px 14px", background: plan.feasible ? v("okSoft") : v("actSoft"), color: v("ink") }}>
              {plan.feasible ? <Check size={18} style={{ flex: "none", marginTop: 2, color: v("brand") }} /> : <TriangleAlert size={18} style={{ flex: "none", marginTop: 2, color: v("act") }} />}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  {plan.feasible
                    ? "Every field climbs back to comfort"
                    : atBest
                      ? "Some fields are drying faster than the rotation can water them"
                      : `${plan.guns.length} reel gun${plan.guns.length > 1 ? "s" : ""} can't out-run the crop's water use`}
                </span>
                <span style={{ fontSize: 13, color: v("ink2"), lineHeight: 1.45 }}>
                  {plan.feasible
                    ? `The ${plan.guns.length} reel gun${plan.guns.length > 1 ? "s deliver" : " delivers"} water faster than the crops drink it, so every field recovers.`
                    : atBest
                      ? "Even one gun per field can't shorten the rotation enough to out-run these crops' use. Keep the rotation going; they'll hold, not climb."
                      : "A gun is still elsewhere when a field needs it, so the field keeps falling. Add a reel gun to shorten the rotation."}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: plan.comfortInDays === null ? v("act") : v("brand") }}>{comfortLabel(plan, atBest)}</span>
                {!plan.feasible && gunCount < suggested && (
                  <button type="button" onClick={() => setGunCount(suggested)} style={{ alignSelf: "flex-start", height: 40, padding: "0 14px", borderRadius: 20, border: `1.5px solid ${v("ink")}`, background: "transparent", color: v("ink"), fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Try with {suggested} reel gun{suggested > 1 ? "s" : ""}</button>
                )}
              </div>
            </div>

            <Gantt plan={plan} />

            <Label>Runs</Label>
            {(() => {
              const moves = movesBefore(plan);
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[...plan.runs].sort((a, b) => a.startHour - b.startHour).map((r, i) => (
                    <RunRow key={i} r={r} plan={plan} moveFrom={moves.get(r) ?? null} />
                  ))}
                </div>
              );
            })()}

            <div style={{ fontSize: 11, color: v("ink2"), lineHeight: 1.5 }}>
              Doses never exceed what the soil can hold. Time per run = area × mm × 10 ÷ gun flow; guns run day and night. Move time ({plan.moveMinutes} min) and the {plan.pumpM3h} m³/h pump limit come from Farm equipment. Total gun time ≈ {Math.round(plan.totalHours)} h.
            </div>
          </>
        )
      )}
    </div>
  );
}

function Gantt({ plan }: { plan: FarmIrrigationPlan }) {
  const span = plan.horizonDays;
  const LW = 92; // field-label column
  const ng = Math.max(1, plan.guns.length); // guns, for the per-cell G label
  const fields = [...new Set(plan.runs.map((r) => r.fieldId))].map((id) => {
    const o = plan.fields.find((f) => f.fieldId === id);
    return {
      id,
      name: o?.fieldName ?? plan.runs.find((r) => r.fieldId === id)?.fieldName ?? "",
      comfortDay: o?.comfortDay ?? null, // projected day it climbs back above comfort (null = never)
      gapMm: o?.gapMm ?? [], // projected mm still below comfort after each day
    };
  });
  const DAYW = 56; // fixed width per day — the grid scrolls sideways, cells stay equal
  const CELL = DAYW - 4; // minus the gap
  // The -14px solid surface shadow paints over the scroll container's left gutter so
  // scrolled cells can't peek to the left of the sticky label column.
  const labelSticky: CSSProperties = { width: LW, flex: "none", position: "sticky", left: 0, zIndex: 2, background: v("surface"), borderRight: `1px solid ${v("line")}`, boxShadow: "-14px 0 0 0 var(--tf-surface), 4px 0 6px -3px rgba(15, 24, 19, 0.18)", display: "flex", alignItems: "center", alignSelf: "stretch", paddingRight: 8 };
  // Day grid: one fixed-width column per day, one row per field; scroll sideways to see
  // later dates. A cell is filled when the gun waters that field that day (green on
  // time, amber late), with the dose.
  return (
    // flex: none — the screen is a scrolling flex column; without it the calendar gets
    // squeezed and scrolls inside itself (header cut off, inner scrollbar).
    <section style={{ flex: "none", background: v("surface"), border: `1px solid ${v("line")}`, borderRadius: radius.section, padding: "14px 0 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ overflowX: "auto", padding: "0 12px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: LW + span * DAYW }}>
          {/* day axis */}
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <span style={labelSticky} />
            {Array.from({ length: span }).map((_, d) => {
              const dt = new Date(`${addDays(plan.asOf, d)}T00:00:00Z`);
              return (
                <span key={d} style={{ width: DAYW, flex: "none", textAlign: "center", fontSize: 12, fontWeight: 600, color: d === 0 ? v("ink") : v("ink2"), lineHeight: 1.15 }}>
                  {DOW[dt.getUTCDay()]}<br />{dt.getUTCDate()}
                </span>
              );
            })}
          </div>
          {/* one row per field, one cell per day */}
          {fields.map((f) => (
            <div key={f.id} style={{ display: "flex", alignItems: "center" }}>
              <span style={{ ...labelSticky, fontSize: 14, fontWeight: 700, lineHeight: 1.15, paddingRight: 6 }}>{f.name}</span>
              {Array.from({ length: span }).map((_, d) => {
                const dayStart = d * 24;
                const dayEnd = dayStart + 24;
                const runs = plan.runs.filter((r) => r.fieldId === f.id && r.startHour < dayEnd && r.endHour > dayStart);
                // The row is a recovery bar: amber while still below comfort, green from the
                // projected comfort day on (null = never recovers at this gun count). Watering
                // days are solid with the dose; other days a soft tint of the same state.
                const below = f.comfortDay === null || d < f.comfortDay;
                const run = runs.length > 0;
                const bg = below ? (run ? v("act") : v("actSoft")) : (run ? v("brand") : v("okSoft"));
                const dose = run ? Math.max(...runs.map((r) => r.grossMm)) : null;
                const guns = [...new Set(runs.map((r) => r.gunIndex + 1))];
                // Every pass is the gun's max dose, so the dose alone never changes: under it,
                // what the field still lacks after that day shows it closing in on comfort.
                const gap = dose != null ? (f.gapMm[d] ?? 0) : 0;
                return (
                  <div key={d} style={{ width: DAYW, flex: "none", display: "flex", justifyContent: "center" }}>
                    <div
                      title={run ? runs.map((r) => `${r.fieldName} · Gun ${r.gunIndex + 1} · ${r.grossMm} mm`).join("\n") + (gap > 0 ? `\n${gap} mm still below comfort after today` : "") : ""}
                      style={{ width: CELL, height: 54, borderRadius: 7, background: bg, outline: d === 0 ? `2px solid ${v("ink")}` : "none", outlineOffset: -2, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1, color: run ? "#fff" : v("ink2") }}
                    >
                      {dose != null && <span style={{ fontSize: 17, fontWeight: 700 }}>{dose}</span>}
                      {gap > 0 && <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.9, marginTop: 3 }}>−{gap}</span>}
                      {dose != null && ng > 1 && <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.85, marginTop: 2 }}>{guns.map((g) => `G${g}`).join("+")}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {/* legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", fontSize: 12, color: v("ink2"), padding: "0 12px", marginTop: 2 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 12, borderRadius: 3, background: v("brand") }} />Back to comfort</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 12, borderRadius: 3, background: v("act") }} />Below comfort</span>
        <span>number = mm pumped · −n = mm still below comfort after that day{ng > 1 ? " · G = reel gun" : ""} · soft = no watering · outline = today · scroll →</span>
      </div>
    </section>
  );
}

function RunRow({ r, plan, moveFrom }: { r: FarmPlanRun; plan: FarmIrrigationPlan; moveFrom: string | null }) {
  const hours = Math.round(r.endHour - r.startHour);
  const m3 = Math.round(r.areaHa * r.grossMm * 10);
  // This run happens while the field is still below comfort (amber) or once it's recovered
  // (green), by the field's projected comfort day.
  const comfortDay = plan.fields.find((f) => f.fieldId === r.fieldId)?.comfortDay ?? null;
  const below = comfortDay === null || Math.floor(r.startHour / 24) < comfortDay;
  return (
    <>
    {moveFrom && (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 2px 2px 22px", fontSize: 12, color: v("ink2") }}>
        <span style={{ fontSize: 13 }}>↳</span>
        <span>Move Gun {r.gunIndex + 1}: <b style={{ color: v("ink") }}>{moveFrom}</b> → <b style={{ color: v("ink") }}>{r.fieldName}</b></span>
      </div>
    )}
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", background: v("surface"), border: `1px solid ${below ? v("act") : v("line")}`, borderRadius: radius.card, padding: "10px 14px" }}>
      <span style={{ width: 10, height: 38, flex: "none", borderRadius: 3, background: below ? v("act") : v("brand") }} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{r.fieldName} · run {r.runIndex + 1}</span>
          <span style={{ fontSize: 12, color: v("ink2"), whiteSpace: "nowrap" }}>Gun {r.gunIndex + 1}</span>
        </span>
        <span style={{ fontSize: 12, color: v("ink2") }}>{fmtH(plan.asOf, r.startHour)} → {fmtH(plan.asOf, r.endHour)} · {hours} h</span>
        <span style={{ fontSize: 12, color: v("ink2") }}>{r.netMm} mm net · {r.grossMm} gross · {m3.toLocaleString()} m³ · {r.areaHa} ha</span>
        {r.bumped && r.note && (
          <span style={{ alignSelf: "flex-start", marginTop: 4, fontSize: 11, fontWeight: 600, background: v("okSoft"), color: v("brand"), borderRadius: 999, padding: "2px 8px" }}>{r.note}</span>
        )}
      </div>
    </div>
    </>
  );
}
