import { ArrowRight, Check, Droplet, X } from "lucide-react";
import { navigate } from "../../app/router";
import { font, radius, v } from "../../theme/tokens";

// Renders one AI SDK tool part as a card. The 8 tool keys are the UI contract
// (apps/api chat/README.md). Unknown keys / invalid output fall back gracefully
// — the chat never crashes on a part it doesn't know.

export type ToolState = "input-streaming" | "input-available" | "output-available" | "output-error";

export function WidgetRenderer({
  toolKey,
  state,
  output,
  onReply,
}: {
  toolKey: string;
  state: ToolState;
  output?: unknown;
  onReply?: (text: string) => void;
}) {
  if (state === "input-streaming" || state === "input-available") return <Skeleton />;
  if (state === "output-error") return <Card tone="error">Couldn't run {label(toolKey)}.</Card>;

  const o = asObj(output);
  switch (toolKey) {
    case "getFieldReport":
      return <FieldReportCard r={o} />;
    case "getFarmAdvice":
      return <AdviceCard reports={asArr(o.reports)} />;
    case "recordIrrigation":
      return <ConfirmCard o={o} onReply={onReply} />;
    case "confirmIrrigation":
      return <ConfirmedBadge o={o} />;
    case "resolveField":
      return <FieldChips matches={asArr(o.matches)} />;
    case "getWeather":
      return <WeatherCard days={asArr(o.days)} />;
    case "simulateScenario":
      return <ScenarioCard o={o} />;
    case "getIrrigationHistory":
      return <HistoryCard records={asArr(o.records)} />;
    default:
      return <FallbackCard toolKey={toolKey} fieldId={num(o.fieldId)} />;
  }
}

// ---- cards ---------------------------------------------------------------

function FieldReportCard({ r }: { r: Rec }) {
  const fieldId = num(r.fieldId);
  const mm = num(r.irrigateMm);
  const decision = str(r.decision);
  return (
    <Card>
      <Head title={str(r.fieldName) ?? "Field"} badge={decisionLabel(decision)} tone={decision === "irrigate_today" ? "act" : "ok"} />
      {mm != null && mm > 0 && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 34, color: v("act") }}>{mm}</span>
          <span style={{ fontFamily: font.display, fontWeight: 600, fontSize: 16, color: v("act") }}>mm</span>
        </div>
      )}
      {str(r.reason) && <p style={pStyle}>{str(r.reason)}</p>}
      {fieldId != null && <DeepLink label="See the parcel" to={`parcel/${fieldId}#balance`} />}
    </Card>
  );
}

function AdviceCard({ reports }: { reports: unknown[] }) {
  return (
    <Card>
      <Head title="Today's fields" />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {reports.map((raw, i) => {
          const r = asObj(raw);
          const mm = num(r.irrigateMm);
          return (
            <button key={i} type="button" onClick={() => num(r.fieldId) != null && navigate(`parcel/${num(r.fieldId)}`)} style={rowBtn}>
              <span style={{ fontWeight: 600 }}>{str(r.fieldName) ?? "Field"}</span>
              <span style={{ fontSize: 13, color: v("ink2") }}>{decisionLabel(str(r.decision))}{mm ? ` · ${mm} mm` : ""}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function ConfirmCard({ o, onReply }: { o: Rec; onReply?: (t: string) => void }) {
  return (
    <Card tone="act">
      <Head title="Confirm watering" tone="act" badge="Awaiting" />
      <p style={pStyle}>{str(o.summary) ?? `${str(o.fieldName)} · ${num(o.mm)} mm · ${str(o.date)}`}</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <button type="button" onClick={() => onReply?.("Oui")} style={{ ...btn, background: v("brand"), color: v("bg") }}>
          <Check size={16} strokeWidth={2.5} /> Oui
        </button>
        <button type="button" onClick={() => onReply?.("Non")} style={{ ...btn, background: v("surface"), color: v("ink"), border: `1px solid ${v("line")}` }}>
          <X size={16} strokeWidth={2.5} /> Non
        </button>
      </div>
    </Card>
  );
}

function ConfirmedBadge({ o }: { o: Rec }) {
  const saved = str(o.status) === "saved";
  return (
    <Card tone={saved ? "ok" : undefined}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
        {saved ? <Check size={16} strokeWidth={2.5} color={v("brand")} /> : <X size={16} strokeWidth={2.5} color={v("ink2")} />}
        {saved ? "Saved to the logbook" : "Cancelled"}
      </span>
    </Card>
  );
}

function FieldChips({ matches }: { matches: unknown[] }) {
  return (
    <Card>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {matches.map((raw, i) => {
          const m = asObj(raw);
          return (
            <button key={i} type="button" onClick={() => num(m.fieldId) != null && navigate(`parcel/${num(m.fieldId)}`)} style={chip}>
              {str(m.name) ?? "Field"}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function WeatherCard({ days }: { days: unknown[] }) {
  return (
    <Card>
      <Head title="Weather" />
      <div style={{ display: "flex", gap: 10, overflowX: "auto" }}>
        {days.map((raw, i) => {
          const d = asObj(raw);
          return (
            <div key={i} style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 48 }}>
              <span style={{ fontSize: 11, color: v("ink2") }}>{(str(d.date) ?? "").slice(5)}</span>
              <Droplet size={14} color={v("water")} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{num(d.rain) ?? 0}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ScenarioCard({ o }: { o: Rec }) {
  const cmp = asObj(o.comparison);
  return (
    <Card>
      <Head title="What-if" />
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: font.display, fontWeight: 700, fontSize: 22 }}>
        <span>{num(cmp.mmBefore) ?? 0} mm</span>
        <ArrowRight size={18} />
        <span style={{ color: v("act") }}>{num(cmp.mmAfter) ?? 0} mm</span>
      </div>
      {str(cmp.summary) && <p style={pStyle}>{str(cmp.summary)}</p>}
    </Card>
  );
}

function HistoryCard({ records }: { records: unknown[] }) {
  return (
    <Card>
      <Head title="Irrigation history" />
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {records.map((raw, i) => {
          const r = asObj(raw);
          return (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: v("ink2") }}>{str(r.date)}</span>
              <span style={{ fontWeight: 600 }}>{num(r.mm)} mm</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function FallbackCard({ toolKey, fieldId }: { toolKey: string; fieldId?: number | null }) {
  return (
    <Card>
      <Head title={label(toolKey)} />
      {fieldId != null && <DeepLink label="Open the parcel" to={`parcel/${fieldId}`} />}
    </Card>
  );
}

// ---- shared bits ---------------------------------------------------------

function Skeleton() {
  return <div aria-hidden="true" style={{ height: 72, borderRadius: radius.card, background: v("sunk"), opacity: 0.6 }} />;
}

function Card({ children, tone }: { children: React.ReactNode; tone?: "act" | "ok" | "error" }) {
  const border = tone === "act" ? v("act") : tone === "error" ? v("act") : v("line");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, background: v("surface"), border: `${tone === "act" ? 1.5 : 1}px solid ${border}`, borderRadius: radius.card, padding: 14 }}>
      {children}
    </div>
  );
}

function Head({ title, badge, tone }: { title: string; badge?: string; tone?: "act" | "ok" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <span style={{ fontFamily: font.display, fontWeight: 600, fontSize: 18 }}>{title}</span>
      {badge && (
        <span style={{ fontSize: 11, fontWeight: 600, borderRadius: radius.pill, padding: "3px 9px", background: tone === "act" ? v("act") : v("okSoft"), color: tone === "act" ? v("bg") : v("ink") }}>{badge}</span>
      )}
    </div>
  );
}

function DeepLink({ label: l, to }: { label: string; to: string }) {
  return (
    <button type="button" onClick={() => navigate(to)} style={{ ...rowBtn, color: v("water"), fontWeight: 600 }}>
      {l}
      <ArrowRight size={16} />
    </button>
  );
}

const pStyle: React.CSSProperties = { margin: 0, fontSize: 14, lineHeight: 1.45, color: v("ink") };
const btn: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 10, border: 0, fontWeight: 600, fontSize: 15, cursor: "pointer" };
const rowBtn: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", background: "transparent", border: 0, padding: "4px 0", color: v("ink"), cursor: "pointer", textAlign: "left", font: "inherit" };
const chip: React.CSSProperties = { border: `1px solid ${v("line")}`, background: v("sunk"), borderRadius: radius.pill, padding: "6px 12px", fontSize: 13, fontWeight: 600, color: v("ink"), cursor: "pointer" };

// ---- loose output accessors (tool output is validated server-side) --------

type Rec = Record<string, unknown>;
const asObj = (x: unknown): Rec => (x && typeof x === "object" ? (x as Rec) : {});
const asArr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string | undefined => (typeof x === "string" ? x : undefined);
const num = (x: unknown): number | null => (typeof x === "number" ? x : null);

const LABELS: Record<string, string> = {
  getFieldReport: "Field report",
  getFarmAdvice: "Farm advice",
  recordIrrigation: "Record watering",
  confirmIrrigation: "Confirmation",
  resolveField: "Fields",
  getWeather: "Weather",
  simulateScenario: "What-if",
  getIrrigationHistory: "History",
};
const label = (k: string): string => LABELS[k] ?? k;

const DECISIONS: Record<string, string> = {
  irrigate_today: "Irrigate",
  frost_hold: "Hold · frost",
  plan_irrigation: "Irrigate soon",
  wait_for_rain: "Wait for rain",
  crop_maturing: "Maturing · stop",
  no_irrigation: "No water needed",
  not_irrigable: "Not irrigable",
  outside_season: "Off season",
};
const decisionLabel = (d?: string): string => (d ? DECISIONS[d] ?? d : "");
