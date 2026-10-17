import { CalendarRange, ChevronDown, ChevronRight, Droplet, Sun } from "lucide-react";
import { useState } from "react";
import type { FarmFieldOutcome, FarmToday, ParcelSummary } from "@tellia/shared";
import { getFarmToday } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { farmAccent, useFarm } from "../../app/FarmContext";
import { useFarmPlan } from "../../app/FarmPlanContext";
import { navigate } from "../../app/router";
import { font, radius, v } from "../../theme/tokens";
import { Label, StatusPill } from "../../components/ui/primitives";
import { DateButton } from "../../components/DateSheet";
import { Loader } from "../../components/ui/Loader";
import { PersonaSheet } from "./PersonaSheet";

export function TodayScreen() {
  const { farm, farms } = useFarm();
  const { plan } = useFarmPlan();
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

        <TodayPlanCard />
        <TodayMovesCard />

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Label>Today's actions</Label>
          {data.parcels.map((p) =>
            p.status === "action"
              ? <ActionCard key={p.id} p={p} outcome={plan?.fields.find((f) => f.fieldId === p.id) ?? null} />
              : <ParcelRow key={p.id} p={p} />,
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

function TodayPlanCard() {
  const { plan, loading } = useFarmPlan();
  const today = plan ? plan.runs.filter((r) => Math.floor(r.startHour / 24) === 0) : [];
  const summary = loading
    ? "Planning the reel-gun rotation…"
    : !plan || plan.runs.length === 0
      ? "No watering scheduled this week"
      : today.length > 0
        ? today.slice(0, 2).map((r) => `Gun ${r.gunIndex + 1} → ${r.fieldName} ${r.grossMm} mm`).join(" · ")
        : `${plan.runs.length} runs over the week · ${plan.guns.length} reel gun${plan.guns.length > 1 ? "s" : ""}`;
  return (
    <button
      type="button"
      onClick={() => navigate("plan")}
      style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", textAlign: "left", color: v("ink"), background: v("surface"), border: `1.5px solid ${v("brand")}`, borderRadius: radius.card, padding: 16, cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 40, height: 40, flex: "none", borderRadius: 20, background: v("brand"), color: v("bg"), display: "flex", alignItems: "center", justifyContent: "center" }}>
          <CalendarRange size={20} strokeWidth={2} />
        </span>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
          <span style={{ fontFamily: font.display, fontWeight: 600, fontSize: 20 }}>Irrigation plan</span>
          <span style={{ fontSize: 12, color: v("ink2") }}>Reel-gun rotation across the fields</span>
        </div>
        <ChevronRight size={20} style={{ color: v("ink2") }} />
      </div>
      <div style={{ fontSize: 13, color: today.length > 0 ? v("ink") : v("ink2") }}>
        {today.length > 0 ? <strong>Today · </strong> : null}{summary}
      </div>
      {plan && !plan.feasible && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: v("act") }}>
          <span style={{ fontSize: 14 }}>⚠</span> One gun can't keep up — tap to add a reel gun
        </div>
      )}
    </button>
  );
}

/** Today's reel-gun moves: for each gun, the runs it does today and when it must be moved
 *  from one field to the next. A gun can't be two places at once, so each move is a task. */
function TodayMovesCard() {
  const { plan } = useFarmPlan();
  if (!plan || plan.runs.length === 0) return null;
  const byGun = new Map<number, typeof plan.runs>();
  for (const r of plan.runs) {
    const arr = byGun.get(r.gunIndex) ?? [];
    arr.push(r);
    byGun.set(r.gunIndex, arr);
  }
  type Task = { gun: number; field: string; at: number; move: boolean };
  const tasks: Task[] = [];
  for (const [gun, runs] of byGun) {
    const sorted = [...runs].sort((a, b) => a.startHour - b.startHour);
    sorted.forEach((r, i) => {
      if (Math.floor(r.startHour / 24) !== 0) return; // today only
      const moved = i > 0 && sorted[i - 1]!.fieldName !== r.fieldName;
      // Keep the first placement of the day and every real move; skip staying put.
      if (i > 0 && !moved) return;
      tasks.push({ gun, field: r.fieldName, at: r.startHour % 24, move: moved });
    });
  }
  tasks.sort((a, b) => a.at - b.at);
  if (tasks.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Label>Reel-gun moves today</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {tasks.map((t, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: v("surface"), border: `1px solid ${v("line")}`, borderRadius: radius.card, padding: "10px 14px" }}>
            <span style={{ width: 30, height: 30, flex: "none", borderRadius: 15, background: v("sunk"), color: v("ink"), display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13 }}>G{t.gun + 1}</span>
            <span style={{ flex: 1, fontSize: 13 }}>
              <b>{fmtHour(t.at)}</b> — {t.move ? "move to" : "set up on"} <b>{t.field}</b>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtShortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${d.getUTCDate()}`;
}
const fmtHour = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:00`;

function ActionCard({ p, outcome }: { p: ParcelSummary; outcome: FarmFieldOutcome | null }) {
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
      {outcome && (
        <div style={{ fontSize: 12, fontWeight: 600, color: outcome.todayGross != null ? v("brand") : outcome.late ? v("act") : v("ink2") }}>
          {outcome.todayGross != null
            ? `Plan: water today · Gun ${(outcome.todayGunIndex ?? 0) + 1}${outcome.todayStartHour != null ? ` from ${fmtHour(outcome.todayStartHour)}` : ""}`
            : outcome.late
              ? `Plan: gun busy — next ${outcome.nextDate ? fmtShortDay(outcome.nextDate) : "soon"} (dips below comfort)`
              : outcome.nextDate
                ? `Plan: ${fmtShortDay(outcome.nextDate)} · Gun ${(outcome.todayGunIndex ?? 0) + 1}`
                : ""}
        </div>
      )}
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
