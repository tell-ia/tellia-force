import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { FarmToday, IrrigationRecord, ParcelReport, ParcelSummary } from "@tellia/shared";
import { deleteIrrigation, getFarmToday, getParcelReport, listIrrigations, recordIrrigation, simulateDose, type DoseSim } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { useWheelScrollX } from "../../lib/useWheelScrollX";

/** Debounce a fast-changing value (the dose stepper) before firing the engine call. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
import { useFarm } from "../../app/FarmContext";
import { useDemoDate } from "../../app/DateContext";
import { addDays, formatDay, shortDay, weekday } from "../../lib/dates";
import { cropLine } from "../../lib/mappers/parcel";
import { navigate } from "../../app/router";
import { font, radius, v } from "../../theme/tokens";
import { Label, SectionCard } from "../../components/ui/primitives";
import { IrrigationLog } from "../parcel/IrrigationLog";
import { Loader } from "../../components/ui/Loader";
import { DateField } from "../../components/ui/DateField";

export function LogScreen({ fieldId }: { fieldId?: number }) {
  const { farm } = useFarm();
  const { today: demoToday } = useDemoDate();
  const { data: today } = useAsync<FarmToday | null>(
    () => (farm ? getFarmToday(farm) : Promise.resolve(null)),
    [farm?.id],
  );
  // The field: the one asked for (#/log/:id or a chip), else the one that needs water today.
  const [picked, setPicked] = useState<number | null>(fieldId ?? null);
  const parcels = today?.parcels ?? [];
  const action = parcels.find((p) => p.status === "action") ?? parcels[0];
  const parcelId = picked ?? action?.id ?? null;

  const { data, loading, error } = useAsync<ParcelReport | null>(
    () => (parcelId ? getParcelReport(parcelId) : Promise.resolve(null)),
    [parcelId],
  );

  const eff = data?.recommendation.efficiency ?? 0.8;
  const advisedGross = Math.round(data?.recommendation.grossMm ?? 0);
  const advisedNet = Math.round(data?.recommendation.netMm ?? advisedGross * eff);

  // `amount` = what was applied AT THE GUN (gross). Defaults to the advised dose.
  const [amount, setAmount] = useState<number | null>(null);
  // The saved irrigation (real row in the DB), or null. Undo deletes it.
  const [saved, setSaved] = useState<IrrigationRecord | null>(null);
  // The field's past waterings under the form; reloaded after each save or undo.
  const [logVersion, setLogVersion] = useState(0);
  const history = useAsync<IrrigationRecord[]>(
    () => (parcelId ? listIrrigations(parcelId) : Promise.resolve([])),
    [parcelId, logVersion],
  );
  const logRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The day of the watering: today by default, or a past day of this crop season.
  const [day, setDay] = useState<string | null>(null);
  const logged = saved !== null;
  useEffect(() => {
    if (data) {
      setAmount(advisedGross || 35);
      setSaved(null);
      setSaveError(null);
      setDay(null);
    }
  }, [data, advisedGross]);

  const gross = amount ?? advisedGross;
  const net = Math.round(gross * eff); // what actually reaches the soil
  const delta = gross - advisedGross; // vs the advised dose
  const asOf = data?.asOf ?? demoToday;
  const logDay = day ?? asOf;
  // A watering can't be logged before sowing (no crop) or after today.
  const firstDay = data?.sownOn && data.sownOn < asOf ? data.sownOn : addDays(asOf, -365);

  const cap = data?.reserve.capacityMm ?? 144;
  const threshold = data?.reserve.thresholdMm ?? 79;

  // ACCURACY: the Effect block ONLY ever shows a real FAO-56 engine result — never
  // a front guess. Every dose change (debounced) fires one /simulate; rapid +5
  // clicks collapse to a single call for the last value. `shown` holds the last
  // resolved result; `pending` is true while a newer one is on the way.
  const debouncedGross = useDebounced(gross, 350);
  const { data: sim, loading: simLoading } = useAsync<DoseSim | null>(
    () => (parcelId && debouncedGross > 0 ? simulateDose(parcelId, asOf, logDay, debouncedGross) : Promise.resolve(null)),
    [parcelId, asOf, logDay, debouncedGross],
  );
  const [shown, setShown] = useState<DoseSim | null>(null);
  useEffect(() => {
    if (sim) setShown(sim);
  }, [sim]);
  // Reset the shown result when the parcel changes.
  useEffect(() => {
    setShown(null);
  }, [parcelId]);
  const pending = simLoading || debouncedGross !== gross || (shown?.grossMm ?? -1) !== gross;

  // Numbers reflect the *shown* (resolved) dose, so the Effect block stays coherent
  // while a newer simulation is loading.
  const shownGross = shown?.grossMm ?? gross;
  const shownNet = Math.round(shownGross * eff);
  const drained = shown?.drainedMm ?? 0;

  // The chart window: 4 days before today to the end of the forecast.
  const winFrom = addDays(asOf, -4);
  const winBase = useMemo(() => (data?.series ? data.series.filter((p) => p.date >= winFrom) : []), [data, winFrom]);
  const winWith = useMemo<WinPoint[]>(
    () => (shown ? shown.series.filter((p) => p.date >= winFrom) : []),
    [shown, winFrom],
  );

  // LIVE: saves a confirmed irrigation (counts in the next report/advice). "Saved" only on success.
  const confirm = async () => {
    if (!parcelId || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      setSaved(await recordIrrigation({ parcelId, date: logDay, grossMm: gross }));
      setLogVersion((n) => n + 1);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const undo = async () => {
    if (!saved || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await deleteIrrigation(saved.operationId);
      setSaved(null);
      setLogVersion((n) => n + 1);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const chips = <FieldChips parcels={parcels} selected={parcelId} disabled={saving} onPick={setPicked} />;

  if (loading || !data || amount === null) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "12px 16px 20px" }}>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1, padding: "4px 4px 0" }}>
          <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 34 }}>Log watering</span>
          <span style={{ fontSize: 13, color: v("ink2") }}>Log what you applied — the reserve updates.</span>
        </div>
        {chips}
        {error ? <div role="alert" style={{ color: v("act"), fontSize: 14, padding: "12px 4px" }}>Couldn't load this field: {error}</div> : <Loader />}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16, padding: "12px 16px 20px" }}>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1, padding: "4px 4px 0" }}>
        <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 34 }}>Log watering</span>
        <span style={{ fontSize: 13, color: v("ink2") }}>Log what you did — the reserve updates.</span>
      </div>

      {chips}

      {saved && (
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, background: v("brand"), color: v("bg"), borderRadius: radius.card, padding: "8px 8px 8px 14px" }}>
          <Check size={20} strokeWidth={2.5} />
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>Saved: {saved.mm} mm on {data.name}, {formatDay(saved.date)}.</span>
          <button type="button" onClick={() => logRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} style={{ height: 44, flex: "none", padding: "0 12px", borderRadius: 22, border: 0, background: v("bg"), color: v("brand"), fontWeight: 600, cursor: "pointer" }}>See the log</button>
        </div>
      )}
      {saveError && (
        <div role="alert" style={{ background: v("actSoft"), color: v("ink"), borderRadius: radius.card, padding: "12px 14px", fontSize: 14 }}>
          Not saved: {saveError}
        </div>
      )}

      {/* Parsed details */}
      <section aria-label="Details" style={{ background: v("surface"), border: `1px solid ${v("line")}`, borderRadius: radius.section, padding: "6px 16px", display: "flex", flexDirection: "column" }}>
        <Row label="Parcel" value={data.name} />
        <Row label="Crop" value={cropLine(data.cropName, data.cropStage?.label)} />
        <LogDateRow day={logDay} today={asOf} min={firstDay} disabled={logged || saving} onChange={setDay} />
        {/* What TelliaForce advised — the target. */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 52, borderBottom: `1px solid ${v("line")}` }}>
          <span style={{ fontSize: 13, color: v("ink2") }}>TelliaForce advised</span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 700, color: v("brand") }}>{advisedGross} mm</span>
            <span style={{ fontSize: 12, color: v("ink2") }}>≈ {advisedNet} mm to soil</span>
          </span>
        </div>
        {/* Applied at the gun — the stepper. */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 64, borderBottom: `1px solid ${v("line")}` }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 13, color: v("ink") }}>Applied (at the gun)</span>
            <span style={{ fontSize: 11, color: v("ink2") }}>≈ {net} mm reaches the soil</span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <StepBtn label="Less" disabled={logged || saving} onClick={() => setAmount((a) => Math.max(5, (a ?? gross) - 5))}>−</StepBtn>
            <span style={{ width: 76, textAlign: "center", fontFamily: font.display, fontWeight: 700, fontSize: 30, color: v("ink") }}>{gross} mm</span>
            <StepBtn label="More" disabled={logged || saving} onClick={() => setAmount((a) => Math.min(120, (a ?? gross) + 5))}>+</StepBtn>
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 44 }}>
          <span style={{ fontSize: 13, color: v("ink2") }}>Method</span>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
            Reel gun
            {delta !== 0 && (
              <span style={{ fontSize: 12, fontWeight: 600, color: v("ink2") }}>
                {delta > 0 ? `+${delta}` : delta} mm vs advised
              </span>
            )}
          </span>
        </div>
        {drained > 0 && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 0 10px", fontSize: 12, color: v("act") }}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>⚠</span>
            <span>≈ {drained} mm above field capacity → drains away (N leaching), no yield gain.</span>
          </div>
        )}
      </section>

      {/* Effect on soil water — real FAO-56, re-simulated on every dose change */}
      <section style={{ position: "relative", background: v("surface"), border: `1px solid ${v("line")}`, borderRadius: radius.section, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Label>Effect on soil water</Label>
          <span style={{ fontSize: 12, fontWeight: 600, color: pending ? v("ink2") : v("water") }}>
            {logged ? "Saved" : pending ? "Simulating…" : "FAO-56"}
          </span>
        </div>
        {!shown ? (
          <div style={{ minHeight: 180 }}><Loader /></div>
        ) : (
          <>
            <DoseSplit net={shownNet} drained={drained} />
            <EffectTiles base={winBase} withW={winWith} cap={cap} threshold={threshold} asOf={asOf} />
            <LogEffectChart base={winBase} withW={winWith} cap={cap} threshold={threshold} drained={drained} />
            <div style={{ fontSize: 11, color: v("ink2"), lineHeight: 1.5 }}>
              Real FAO-56 balance for this dose{drained > 0 ? " — surplus above field capacity drains away, not stored" : ""}. Below the line the crop closes its stomata and loses yield.
            </div>
          </>
        )}
        {shown && pending && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ position: "absolute", inset: 0, background: v("surface"), opacity: 0.8 }} />
            <div style={{ position: "relative" }}><Loader /></div>
          </div>
        )}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        {logged ? (
          <button type="button" onClick={() => void undo()} disabled={saving} style={{ height: 54, borderRadius: radius.card, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), fontWeight: 600, cursor: saving ? "default" : "pointer" }}>{saving ? "Deleting…" : "Undo"}</button>
        ) : (
          <button type="button" onClick={() => navigate(`parcel/${parcelId}`)} style={{ height: 54, borderRadius: radius.card, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), fontWeight: 600, cursor: "pointer" }}>Cancel</button>
        )}
        <button type="button" onClick={() => void confirm()} disabled={logged || saving || pending || !shown} style={{ height: 54, borderRadius: radius.card, border: 0, fontWeight: 600, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", cursor: logged || saving || pending || !shown ? "default" : "pointer", opacity: !logged && (saving || pending || !shown) ? 0.55 : 1, background: logged ? v("okSoft") : v("brand"), color: logged ? v("brand") : v("bg") }}>
          {logged ? "Saved" : saving ? "Saving…" : pending || !shown ? "Simulating…" : `Confirm ${gross} mm`}
        </button>
      </div>

      <SectionCard id="log" style={{ gap: 10 }}>
        <div ref={logRef} />
        <IrrigationLog records={history.data} loading={history.loading} error={history.error} highlightId={saved?.operationId} />
      </SectionCard>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 52, borderBottom: `1px solid ${v("line")}` }}>
      <span style={{ fontSize: 13, color: v("ink2") }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function StepBtn({ label, onClick, disabled = false, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} disabled={disabled} style={{ width: 44, height: 44, borderRadius: 22, border: `1px solid ${v("line")}`, background: v("bg"), color: v("ink"), fontSize: 20, lineHeight: 1, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1 }}>{children}</button>
  );
}

/** The watering's day in the details: a date field with a small calendar (sowing to today). */
export function LogDateRow({ day, today, min, disabled, onChange }: { day: string; today: string; min: string; disabled: boolean; onChange: (day: string) => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 60, borderBottom: `1px solid ${v("line")}` }}>
      <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontSize: 13, color: v("ink2") }}>Date</span>
        {day === today && <span style={{ fontSize: 11, color: v("ink2") }}>today</span>}
      </span>
      <DateField value={day} min={min} max={today} today={today} disabled={disabled} ariaLabel="Day of the watering" onChange={onChange} />
    </div>
  );
}

/** One chip per field of the farm, most urgent first (the advice order). */
export function FieldChips({ parcels, selected, disabled, onPick }: { parcels: ParcelSummary[]; selected: number | null; disabled: boolean; onPick: (id: number) => void }) {
  const row = useWheelScrollX<HTMLDivElement>();
  if (parcels.length === 0) return null;
  return (
    <div ref={row} role="group" aria-label="Field" style={{ flex: "none", display: "flex", gap: 8, overflowX: "auto", margin: "0 -16px", padding: "0 16px 2px", touchAction: "pan-x pan-y", userSelect: "none", cursor: "grab" }}>
      {parcels.map((p) => {
        const on = p.id === selected;
        return (
          <button key={p.id} type="button" aria-pressed={on} disabled={disabled} onClick={() => onPick(p.id)} style={{ flex: "none", height: 44, padding: "0 14px", borderRadius: 22, whiteSpace: "nowrap", fontSize: 13, fontWeight: 600, cursor: disabled ? "default" : "pointer", border: on ? `2px solid ${v("brand")}` : `1px solid ${v("line")}`, background: on ? v("okSoft") : v("surface"), color: v("ink") }}>
            {p.name}
            {p.status === "action" && <span style={{ marginLeft: 6, color: v("act") }}>●</span>}
          </button>
        );
      })}
    </div>
  );
}

// Dose split: of the net water reaching the soil, how much actually refills the
// reserve vs. how much is above field capacity and drains away. Pushing the dose
// past the deficit grows the wasted (red) part, not the stored (blue) part.
function DoseSplit({ net, drained }: { net: number; drained: number }) {
  const useful = Math.max(0, net - drained);
  const usefulPct = net > 0 ? (useful / net) * 100 : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ height: 12, borderRadius: 6, background: v("sunk"), overflow: "hidden", display: "flex" }}>
        <div style={{ width: `${usefulPct}%`, background: v("water") }} />
        {drained > 0 && <div style={{ flex: 1, background: v("act") }} />}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
        <span style={{ color: v("water"), fontWeight: 600 }}>{useful} mm into the soil</span>
        {drained > 0
          ? <span style={{ color: v("act"), fontWeight: 600 }}>{drained} mm wasted</span>
          : <span style={{ color: v("ink2") }}>all stored</span>}
      </div>
    </div>
  );
}

interface WinPoint { date: string; dayLabel: string; reserveMm: number; forecast: boolean }

function pctOf(mm: number, cap: number): number {
  return Math.round((mm / cap) * 100);
}

// Tiles: the reserve in 2 and 5 days, and the first evening (next 5 days) below the threshold.
// Days come from the dates (they were fixed to the 15th and 18th of the 13 July 2022 prototype).
function EffectTiles({ base, withW, cap, threshold, asOf }: { base: WinPoint[]; withW: WinPoint[]; cap: number; threshold: number; asOf: string }) {
  const atB = (day: string) => base.find((p) => p.date === day);
  const atW = (day: string) => withW.find((p) => p.date === day);
  const hit = withW.find((p) => p.date > asOf && p.date <= addDays(asOf, 5) && p.reserveMm < threshold);
  const stressDay = hit ? `${weekday(hit.date)} eve` : "Not this week";
  const in2 = addDays(asOf, 2);
  const in5 = addDays(asOf, 5);
  const tile = (caption: string, day: string) => {
    const w = atW(day);
    const b = atB(day);
    const pct = pctOf(w?.reserveMm ?? 0, cap);
    const was = pctOf(b?.reserveMm ?? 0, cap);
    const low = pct < 55;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2, background: v("sunk"), borderRadius: radius.tile, padding: 10 }}>
        <span style={{ fontSize: 11, color: v("ink2") }}>{caption}</span>
        <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 30, lineHeight: 1, color: low ? v("act") : v("water") }}>{pct}%</span>
        <span style={{ fontSize: 11, color: v("ink2") }}>{pct !== was ? `was ${was}%` : "no change"}</span>
      </div>
    );
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
      {tile(shortDay(in2), in2)}
      {tile(shortDay(in5), in5)}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, background: stressDay === "Not this week" ? v("okSoft") : v("actSoft"), borderRadius: radius.tile, padding: 10 }}>
        <span style={{ fontSize: 11, color: v("ink2") }}>Hits threshold</span>
        <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>{stressDay}</span>
        <span style={{ fontSize: 11, color: v("ink2") }}>next 5 days</span>
      </div>
    </div>
  );
}

function LogEffectChart({ base, withW, cap, threshold, drained }: { base: WinPoint[]; withW: WinPoint[]; cap: number; threshold: number; drained: number }) {
  if (base.length === 0) return null;
  const x = (i: number) => 24 + i * (294 / Math.max(1, base.length - 1));
  const y = (mm: number) => 150 - (mm - 40) * 1.25;
  const yThr = y(threshold);
  const yCap = y(cap);
  const todayIdx = base.reduce((acc, p, i) => (p.forecast ? acc : i), 0);
  const wAt = (i: number) => withW[i]?.reserveMm ?? base[i]!.reserveMm;
  const pt = (i: number, mm: number) => `${x(i).toFixed(1)},${y(mm).toFixed(1)}`;
  const pastPts = base.map((p, i) => (p.forecast ? null : pt(i, p.reserveMm))).filter(Boolean).join(" ");
  const basePts = [pt(todayIdx, base[todayIdx]!.reserveMm), ...base.map((p, i) => (p.forecast ? pt(i, p.reserveMm) : null)).filter(Boolean)].join(" ");
  const withPts = [pt(todayIdx, wAt(todayIdx)), ...base.map((p, i) => (p.forecast ? pt(i, wAt(i)) : null)).filter(Boolean)].join(" ");
  const lastBase = base.at(-1)!.reserveMm;
  const lastWith = wAt(base.length - 1);
  return (
    <svg viewBox="0 0 326 176" width="100%" role="img" aria-label={`Real FAO-56 soil reserve with this dose vs without water, against the ${threshold} mm threshold`} style={{ display: "block", marginLeft: -4, fontFamily: font.body }}>
      <defs>
        <pattern id="tfFc2" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke={v("ink2")} strokeWidth={1} opacity={0.22} />
        </pattern>
      </defs>
      <rect x={x(todayIdx)} y="10" width={326 - x(todayIdx)} height="146" fill="url(#tfFc2)" />
      <text x={x(todayIdx) + 5} y="20" fill={v("ink2")} fontSize="10" fontWeight={600} letterSpacing="0.08em">FORECAST</text>
      <line x1="22" y1="150" x2="320" y2="150" stroke={v("line")} />
      {drained > 0 && (
        <>
          <line x1="22" y1={yCap} x2="320" y2={yCap} stroke={v("ink2")} strokeWidth={1} strokeDasharray="2 3" opacity={0.5} />
          <text x="320" y={yCap - 3} textAnchor="end" fill={v("ink2")} fontSize="9" fontWeight={600}>capacity {cap} · surplus drains</text>
        </>
      )}
      <line x1="22" y1={yThr} x2="320" y2={yThr} stroke={v("act")} strokeWidth={1.5} strokeDasharray="5 3" />
      <text x="18" y={yThr + 3} textAnchor="end" fill={v("act")} fontSize="10" fontWeight={600}>{threshold}</text>
      <polyline points={pastPts} fill="none" stroke={v("water")} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={basePts} fill="none" stroke={v("act")} strokeWidth={2} strokeDasharray="2 4" strokeLinecap="round" />
      <polyline points={withPts} fill="none" stroke={v("water")} strokeWidth={2.75} strokeLinejoin="round" strokeLinecap="round" />
      <text x="320" y={y(lastWith) - 5} textAnchor="end" fill={v("water")} fontSize="9" fontWeight={600}>with water</text>
      <text x="320" y={y(lastBase) + 12} textAnchor="end" fill={v("act")} fontSize="9" fontWeight={600}>skip</text>
      <circle cx={x(todayIdx)} cy={y(base[todayIdx]!.reserveMm)} r="5" fill={v("water")} stroke={v("surface")} strokeWidth={2.5} />
      {base.map((p, i) => (i % 2 === 0 ? <text key={i} x={x(i)} y="170" textAnchor="middle" fill={i === todayIdx ? v("ink") : v("ink2")} fontSize={i === todayIdx ? 11 : 10} fontWeight={i === todayIdx ? 700 : 400}>{p.dayLabel}</text> : null))}
    </svg>
  );
}
