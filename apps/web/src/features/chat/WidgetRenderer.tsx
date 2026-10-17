import { ArrowRight, Check, Droplet, Trash2, TriangleAlert, X } from "lucide-react";
import type {
  FarmEconomicsRow,
  FarmLookup,
  FieldDetails,
  FieldDetailsCrop,
  FieldDetailsSoil,
  FieldDetailsSystem,
  FieldJournal,
  IrrigationAmount,
  IrrigationConfirmation,
  IrrigationCorrection,
  IrrigationRecord,
  JournalEntry,
  JournalProduct,
  JournalTotals,
  JournalType,
  LookupTable,
  MarketPriceRow,
  ProductCheck,
  ProductMatch,
  ProductUseRule,
  RegionalBenchmarkRow,
  SaleCropTotal,
  SaleRow,
  SaleSummary,
  SubsidyRow,
  SubsidySummary,
} from "@tellia/shared";
import type { ParcelReport } from "@tellia/shared";
import { useState, type ReactNode } from "react";
import { navigate } from "../../app/router";
import { font, radius, v } from "../../theme/tokens";
import { parcelReportQuery } from "../../lib/api";
import { useQuery } from "../../lib/useQuery";
import { useDemoDate } from "../../app/DateContext";
import { Loader } from "../../components/ui/Loader";
import { irrigateByLabel } from "../../lib/mappers/parcel";
import { BalanceLegend, CropStageTimeline, NextDaysTable, ReserveGauge, SeasonBalanceCard, SoilCard, WaterBalanceChart } from "../parcel/charts";

// Renders one AI SDK tool part as a card. The 13 tool keys are the UI contract
// (apps/api chat/README.md). Unknown keys / invalid output fall back gracefully
// — the chat never crashes on a part it doesn't know.

export type ToolState = "input-streaming" | "input-available" | "output-available" | "output-error";

export function WidgetRenderer({
  toolKey,
  state,
  output,
  onReply,
  answered = false,
}: {
  toolKey: string;
  state: ToolState;
  output?: unknown;
  onReply?: (text: string) => void;
  /** A later message exists: a Oui/Non card is already answered and stays locked. */
  answered?: boolean;
}) {
  if (state === "input-streaming" || state === "input-available") return <Skeleton />;
  if (state === "output-error") return <Card tone="error">Couldn't run {label(toolKey)}.</Card>;

  const o = asObj(output);
  switch (toolKey) {
    case "getFieldReport":
      return <FieldReportCard r={o} />;
    case "showWidget":
      return <WidgetCard r={o} />;
    case "getFarmAdvice":
      return <AdviceCard reports={asArr(o.reports)} />;
    case "recordIrrigation":
      return (
        <ConfirmCard
          title="Confirm watering"
          summary={str(o.summary) ?? joinParts([str(o.fieldName), withUnit(o.mm, "mm"), str(o.date)])}
          onReply={onReply}
          answered={answered}
        />
      );
    case "correctIrrigation":
      return <CorrectionConfirmCard c={objOf<IrrigationCorrection>(output)} onReply={onReply} answered={answered} />;
    case "confirmIrrigation":
      return <ConfirmedBadge c={objOf<IrrigationConfirmation>(output)} />;
    case "resolveField":
      return <FieldChips matches={asArr(o.matches)} />;
    case "getWeather":
      return <WeatherCard days={asArr(o.days)} />;
    case "simulateScenario":
      return <ScenarioCard o={o} />;
    case "getIrrigationHistory":
      return <HistoryCard records={asArr(o.records)} />;
    case "getFieldDetails":
      return <FieldDetailsCard d={objOf<FieldDetails>(output)} />;
    case "getFieldJournal":
      return <JournalCard j={objOf<FieldJournal>(output)} />;
    case "checkProductUse":
      return <ProductCheckCard c={objOf<ProductCheck>(output)} />;
    case "lookupFarmData":
      return <LookupCard l={objOf<FarmLookup>(output)} />;
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
      <Head title={str(r.fieldName) ?? "Field"} badge={reportLabel(r)} tone={decision === "irrigate_today" ? "act" : "ok"} />
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

// Render one report chart on demand (show_widget). The chat and the parcel screen
// share ONE data model: both read the field's ParcelReport from getParcelReport, so
// every widget is identical in both places — no per-widget re-derivation.
function WidgetCard({ r }: { r: Rec }) {
  const fieldId = num(r.fieldId);
  const widget = str(r.widget) ?? "waterBalance";
  const { today } = useDemoDate();
  const { data: pr, loading } = useQuery<ParcelReport>(
    fieldId != null ? parcelReportQuery(fieldId, today) : null,
  );
  const title = WIDGET_TITLE[widget] ?? "Field report";
  if (loading || !pr) {
    return <Card><div style={{ minHeight: 120 }}><Loader /></div></Card>;
  }
  let body: ReactNode = null;
  if (widget === "reserve") body = <ReserveGauge reserve={pr.reserve} />;
  else if (widget === "waterBalance" && pr.series) body = <><WaterBalanceChart series={pr.series} reserve={pr.reserve} plan={pr.plan} /><BalanceLegend withPlan={!!pr.plan} /></>;
  else if (widget === "cropStage" && pr.cropStage) body = <CropStageTimeline cropStage={pr.cropStage} />;
  else if (widget === "nextDays" && pr.nextDays) body = <NextDaysTable days={pr.nextDays} comfortPct={pr.reserve.thresholdPct} />;
  else if (widget === "seasonBalance" && pr.seasonBalance) body = <SeasonBalanceCard season={pr.seasonBalance} />;
  else if (widget === "soil" && pr.soil) body = <SoilCard soil={pr.soil} />;
  return (
    <Card>
      <Head title={`${pr.name} · ${title}`} />
      {body ?? <p style={pStyle}>No data for this chart.</p>}
      {pr.id != null && <DeepLink label="Open the full parcel" to={`parcel/${pr.id}#balance`} />}
    </Card>
  );
}

const WIDGET_TITLE: Record<string, string> = {
  waterBalance: "Water balance",
  reserve: "Soil water reserve",
  cropStage: "Crop stage",
  nextDays: "Next 5 days",
  seasonBalance: "Season balance",
  soil: "Soil",
};

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
              <span style={{ fontSize: 13, color: v("ink2") }}>{reportLabel(r)}{mm ? ` · ${mm} mm` : ""}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/** Yes/no question of a write tool: "Oui" / "Non" are sent as the farmer's reply. */
// Oui / Non: one tap, then both buttons lock and the picked one keeps a check. Cards answered
// earlier in the conversation (a later message exists) are locked too.
function ConfirmCard({ title, summary, onReply, answered = false }: { title: string; summary: string; onReply?: (t: string) => void; answered?: boolean }) {
  const [picked, setPicked] = useState<"Oui" | "Non" | null>(null);
  const locked = picked !== null || answered;
  const pick = (answer: "Oui" | "Non") => {
    if (locked) return;
    setPicked(answer);
    onReply?.(answer);
  };
  const badge = picked === "Oui" ? "Yes sent" : picked === "Non" ? "No sent" : answered ? "Answered" : "Awaiting";
  const dim = (answer: "Oui" | "Non") => (locked && picked !== answer ? 0.4 : 1);
  return (
    <Card tone={locked ? undefined : "act"}>
      <Head title={title} tone={locked ? "ok" : "act"} badge={badge} />
      {summary && <p style={pStyle}>{summary}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <button type="button" disabled={locked} aria-pressed={picked === "Oui"} onClick={() => pick("Oui")} style={{ ...btn, background: v("brand"), color: v("bg"), opacity: dim("Oui"), cursor: locked ? "default" : "pointer" }}>
          <Check size={16} strokeWidth={2.5} /> Oui{picked === "Oui" ? " ✓" : ""}
        </button>
        <button type="button" disabled={locked} aria-pressed={picked === "Non"} onClick={() => pick("Non")} style={{ ...btn, background: v("surface"), color: v("ink"), border: `1px solid ${v("line")}`, opacity: dim("Non"), cursor: locked ? "default" : "pointer" }}>
          <X size={16} strokeWidth={2.5} /> Non{picked === "Non" ? " ✓" : ""}
        </button>
      </div>
    </Card>
  );
}

function CorrectionConfirmCard({ c, onReply, answered }: { c: Loose<IrrigationCorrection>; onReply?: (t: string) => void; answered?: boolean }) {
  const del = str(c.action) === "delete";
  const before = objOf<IrrigationAmount>(c.before);
  const after = objOf<IrrigationAmount>(c.after);
  const was = joinParts([str(before.date), withUnit(before.mm, "mm")], " ");
  const will = joinParts([str(after.date), withUnit(after.mm, "mm")], " ");
  const fallback = del
    ? joinParts([str(c.fieldName), was && `delete ${was}`])
    : joinParts([str(c.fieldName), was && will ? `${was} → ${will}` : was || will]);
  return <ConfirmCard title={del ? "Confirm deletion" : "Confirm correction"} summary={str(c.summary) ?? fallback} onReply={onReply} answered={answered} />;
}

const CONFIRMATION_TEXT: Record<IrrigationConfirmation["status"], string> = {
  saved: "Saved to the logbook",
  updated: "Logbook updated",
  deleted: "Removed from the logbook",
  cancelled: "Cancelled",
};

function ConfirmedBadge({ c }: { c: Loose<IrrigationConfirmation> }) {
  const status = str(c.status);
  const done = status === "saved" || status === "updated" || status === "deleted";
  const record = objOf<IrrigationRecord>(c.record);
  const detail = status === "saved" || status === "updated" ? joinParts([str(record.date), withUnit(record.mm, "mm")]) : "";
  const Icon = status === "deleted" ? Trash2 : done ? Check : X;
  return (
    <Card tone={done ? "ok" : undefined}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
        <Icon size={16} strokeWidth={2.5} color={done ? v("brand") : v("ink2")} />
        {pick(CONFIRMATION_TEXT, status) ?? CONFIRMATION_TEXT.cancelled}
      </span>
      {detail && <span style={{ fontSize: 13, color: v("ink2") }}>{detail}</span>}
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

// getFieldDetails: the field, its crop today, its irrigation system and its latest soil analysis.
function FieldDetailsCard({ d }: { d: Loose<FieldDetails> }) {
  const field = objOf<FieldDetails["field"]>(d.field);
  const fieldId = num(field.id);
  const crop = isObj(d.crop) ? objOf<FieldDetailsCrop>(d.crop) : null;
  const sys = isObj(d.irrigationSystem) ? objOf<FieldDetailsSystem>(d.irrigationSystem) : null;
  const soil = isObj(d.soil) ? objOf<FieldDetailsSoil>(d.soil) : null;
  const irrigable = field.irrigable === true ? "Irrigable" : field.irrigable === false ? "Not irrigable" : undefined;
  const about = joinParts([humanize(str(field.tenure)), irrigable]);
  const nutrients = soil
    ? [
        labeled("N", withUnit(soil.nitrogenGKg, "g/kg", 2)),
        labeled("P", withUnit(soil.phosphorusMgKg, "mg/kg", 0)),
        labeled("K", withUnit(soil.potassiumMgKg, "mg/kg", 0)),
        labeled("S", withUnit(soil.sulfurMgKg, "mg/kg", 0)),
        labeled("Ca", withUnit(soil.calciumMgKg, "mg/kg", 0)),
        labeled("Mg", withUnit(soil.magnesiumMgKg, "mg/kg", 0)),
        labeled("Zn", withUnit(soil.zincMgKg, "mg/kg", 1)),
        labeled("B", withUnit(soil.boronMgKg, "mg/kg", 2)),
      ].filter((s): s is string => !!s)
    : [];
  return (
    <Card>
      <Head title={str(field.name) ?? "Field"} badge={withUnit(field.areaHa, "ha", 2)} tone="muted" />
      {about && <p style={subStyle}>{about}</p>}
      {crop && (
        <Section title="Crop today">
          <Facts
            items={[
              ["Crop", joinParts([str(crop.name), str(crop.variety)])],
              ["Sown", str(crop.sowingDate)],
              ["Harvest", str(crop.harvestDate)],
              ["Status", humanize(str(crop.status))],
              ["Earliness", str(crop.earlinessGroup)],
              ["Previous crop", str(crop.previousCropName)],
            ]}
          />
        </Section>
      )}
      {d.crop === null && <p style={subStyle}>No crop on this field today.</p>}
      {sys && (
        <Section title="Irrigation">
          <Facts
            items={[
              ["System", joinParts([str(sys.name), humanize(str(sys.type))])],
              ["Dose", range(sys.doseMinMm, sys.doseMaxMm, "mm")],
              ["Round", withUnit(sys.roundDays, "days", 0)],
              ["Efficiency", share(sys.efficiency)],
            ]}
          />
        </Section>
      )}
      {soil && (
        <Section title="Soil">
          <Facts
            items={[
              ["Sampled", str(soil.sampledOn)],
              ["Texture", str(soil.textureClass)],
              ["Sand / silt / clay", threeParts(soil.sandPct, soil.siltPct, soil.clayPct, "%")],
              ["Organic matter", withUnit(soil.organicMatterPct, "%")],
              ["pH", fmt(soil.ph)],
              ["CEC", withUnit(soil.cecCmolKg, "cmol/kg")],
              ["Bulk density", withUnit(soil.bulkDensityKgDm3, "kg/dm³", 2)],
              ["Lime need", withUnit(soil.limeRequirementTHa, "t/ha")],
            ]}
          />
          {nutrients.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {nutrients.map((n) => (
                <span key={n} style={tag}>{n}</span>
              ))}
            </div>
          )}
        </Section>
      )}
      {fieldId != null && <DeepLink label="See the parcel" to={`parcel/${fieldId}`} />}
    </Card>
  );
}

const JOURNAL_TYPE_LABELS: Record<JournalType, string> = {
  sowing: "Sowing",
  fertilisation: "Fertiliser",
  spraying: "Spraying",
  irrigation: "Irrigation",
  harvest: "Harvest",
  tillage: "Tillage",
  observation: "Observation",
  other: "Other",
};

// getFieldJournal: totals over the whole range (server-computed), then the latest entries.
function JournalCard({ j }: { j: Loose<FieldJournal> }) {
  const entries = rowsOf<JournalEntry>(j.entries);
  const totals = objOf<JournalTotals>(j.totals);
  const allFields = j.fieldId === null;
  const where = str(j.fieldName) ?? (allFields ? "All fields" : undefined);
  const dates = str(j.from) && str(j.to) ? `${str(j.from)} → ${str(j.to)}` : undefined;
  const byType = Object.entries(asObj(totals.byType))
    .filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0)
    .map(([t, n]) => `${pick(JOURNAL_TYPE_LABELS, t) ?? humanize(t)} ${n}`);
  return (
    <Card>
      <Head title="Journal" badge={pick(JOURNAL_TYPE_LABELS, j.type)} tone="muted" />
      {(where || dates) && <p style={subStyle}>{joinParts([where, dates])}</p>}
      <Stats
        items={[
          { label: "Done", value: fmt(totals.count, 0) },
          { label: "N kg/ha", value: positive(totals.nKgHa) },
          { label: "P₂O₅ kg/ha", value: positive(totals.p2o5KgHa) },
          { label: "K₂O kg/ha", value: positive(totals.k2oKgHa) },
          { label: "Water mm", value: positive(totals.irrigationMm) },
          { label: "Sprays", value: positive(totals.sprays) },
          { label: "Planned", value: positive(totals.planned) },
        ]}
      />
      {byType.length > 0 && <p style={noteStyle}>{byType.join(" · ")}</p>}
      {entries.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {entries.map((e, i) => (
            <JournalRow key={i} e={e} showField={allFields} />
          ))}
        </div>
      ) : (
        <p style={subStyle}>Nothing in the journal for these dates.</p>
      )}
      {j.truncated === true && <p style={noteStyle}>Latest {entries.length} entries shown. The totals cover the whole period.</p>}
    </Card>
  );
}

/** One journal entry. Planned rows (not done yet) have a dashed outline and a "Planned" tag. */
function JournalRow({ e, showField }: { e: Loose<JournalEntry>; showField: boolean }) {
  const planned = e.planned === true;
  const products = rowsOf<JournalProduct>(e.products).map((p) =>
    joinParts([str(p.productName), dose(p.dose, p.doseUnit), str(p.target) && `(${str(p.target)})`], " "),
  );
  const values = joinParts([
    str(e.fertiliserType),
    labeled("N", withUnit(e.nKgHa, "kg/ha")),
    labeled("P₂O₅", withUnit(e.p2o5KgHa, "kg/ha")),
    labeled("K₂O", withUnit(e.k2oKgHa, "kg/ha")),
    withUnit(e.waterMm, "mm"),
    str(e.variety),
    labeled("seed", withUnit(e.seedRateKgHa, "kg/ha")),
    withUnit(e.yieldTHa, "t/ha", 2),
    labeled("moisture", withUnit(e.moisturePct, "%")),
    labeled("protein", withUnit(e.proteinPct, "%")),
    humanize(str(e.method)),
    ...products,
    labeled("BBCH", fmt(e.bbch, 0)),
  ]);
  const title = joinParts([pick(JOURNAL_TYPE_LABELS, e.type) ?? "Operation", showField ? str(e.fieldName) : undefined]);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "8px 10px",
        borderRadius: radius.tile,
        border: `1px ${planned ? "dashed" : "solid"} ${planned ? v("line") : "transparent"}`,
        background: planned ? "transparent" : v("sunk"),
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13 }}>
        <span style={{ fontWeight: 600, color: planned ? v("ink2") : v("ink") }}>{title}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: v("ink2"), whiteSpace: "nowrap" }}>
          {planned && <span style={{ ...tag, background: v("waterSoft") }}>Planned</span>}
          {str(e.date)}
        </span>
      </div>
      {values && <span style={{ fontSize: 13, color: planned ? v("ink2") : v("ink") }}>{values}</span>}
      {str(e.notes) && <span style={{ fontSize: 12, color: v("ink2") }}>{str(e.notes)}</span>}
    </div>
  );
}

// checkProductUse: verdict, the field's history with the product, the E-Phy uses and the warnings.
function ProductCheckCard({ c }: { c: Loose<ProductCheck> }) {
  const status = str(c.status);
  const product = isObj(c.product) ? objOf<ProductMatch>(c.product) : null;
  const crop = isObj(c.crop) ? objOf<NonNullable<ProductCheck["crop"]>>(c.crop) : null;
  const usage = isObj(c.usage) ? objOf<NonNullable<ProductCheck["usage"]>>(c.usage) : null;
  const uses = rowsOf<ProductUseRule>(c.uses);
  const matches = rowsOf<ProductMatch>(c.matches);
  const warnings = texts(c.warnings);
  const verdict = productVerdict(status, c.authorised);
  const blocked = c.authorised === false || c.preHarvestOk === false;
  const where = joinParts([str(c.fieldName), str(crop?.name), str(c.date)]);
  const meta = product
    ? joinParts([
        humanize(str(product.kind)),
        str(product.activeSubstances),
        str(product.ammNumber) && `AMM ${str(product.ammNumber)}`,
        product.synthetic === true ? "not in E-Phy" : undefined,
      ])
    : "";
  return (
    <Card tone={blocked ? "act" : undefined}>
      <Head title={str(product?.name) ?? str(c.query) ?? "Product check"} badge={verdict?.badge} tone={verdict?.tone} />
      {where && <p style={subStyle}>{where}</p>}
      {meta && <p style={noteStyle}>{meta}</p>}
      {status === "not_found" && <p style={pStyle}>No product matches "{str(c.query) ?? ""}".</p>}
      {status === "ambiguous" && (
        <>
          <p style={pStyle}>Several products match. Which one?</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {matches.map((m, i) => (
              <span key={i} style={tag}>{str(m.name) ?? "Product"}</span>
            ))}
          </div>
        </>
      )}
      <Stats
        items={[
          { label: "Uses left", value: fmt(c.applicationsLeft, 0) },
          { label: "Used this season", value: fmt(usage?.timesUsed, 0) },
          { label: "Last used", value: str(usage?.lastDate) },
          { label: "Days to harvest", value: fmt(c.daysToHarvest, 0) },
          {
            label: "Before harvest",
            value: c.preHarvestOk === true ? "OK" : c.preHarvestOk === false ? "Too late" : undefined,
            tone: c.preHarvestOk === false ? "act" : undefined,
          },
        ]}
      />
      {uses.length > 0 && (
        <Section title="Authorised uses">
          {uses.map((u, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>{str(u.target) ?? "Use"}</span>
              <span style={{ color: v("ink2") }}>
                {joinParts([
                  labeled("max", dose(u.maxDose, u.doseUnit)),
                  withUnit(u.maxApplications, "applications", 0),
                  labeled("harvest interval", withUnit(u.preHarvestIntervalDays, "days", 0)),
                  labeled("BBCH", range(u.bbchMin, u.bbchMax)),
                  labeled("buffer", withUnit(u.bufferZoneWaterM, "m from water", 0)),
                ]) || "No limits given"}
              </span>
              {u.preHarvestOk === false && <span style={{ color: v("act"), fontWeight: 600 }}>Too close to harvest</span>}
              {str(u.conditions) && <span style={noteStyle}>{str(u.conditions)}</span>}
            </div>
          ))}
        </Section>
      )}
      {warnings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {warnings.map((w, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 13 }}>
              <TriangleAlert size={14} color={v("act")} aria-hidden="true" style={{ flex: "none", marginTop: 2 }} />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function productVerdict(status: string | undefined, authorised: unknown): { badge: string; tone: HeadTone } | null {
  if (status === "not_found") return { badge: "Not found", tone: "muted" };
  if (status === "ambiguous") return { badge: "Several matches", tone: "muted" };
  if (authorised === true) return { badge: "Authorised", tone: "ok" };
  if (authorised === false) return { badge: "Not authorised", tone: "act" };
  return status ? { badge: "No verdict", tone: "muted" } : null;
}

const LOOKUP_TITLES: Record<LookupTable, string> = {
  sale: "Sales",
  market_price: "Market prices",
  subsidy: "Subsidies",
  farm_economics: "Farm accounts",
  regional_benchmark: "Regional averages",
};

/** The card shows at most this many rows of a lookup; the summary covers all of them. */
const LOOKUP_CARD_ROWS = 8;

// lookupFarmData: the server's summary, a small table and the data note (synthetic or real).
function LookupCard({ l }: { l: Loose<FarmLookup> }) {
  const table = str(l.table);
  const grid = lookupGrid(table, l.rows);
  const shown = grid.body.slice(0, LOOKUP_CARD_ROWS);
  const total = num(l.count) ?? grid.body.length;
  const badge = l.synthetic === true ? "Demo data" : l.synthetic === false ? "Statistics" : undefined;
  const filters = joinParts([str(l.cropCode), yearText(l.year)]);
  return (
    <Card>
      <Head title={pick(LOOKUP_TITLES, table) ?? "Farm data"} badge={badge} tone="muted" />
      {filters && <p style={subStyle}>{filters}</p>}
      {table === "sale" && isObj(l.summary) && <SaleSummaryView s={objOf<SaleSummary>(l.summary)} />}
      {table === "subsidy" && isObj(l.summary) && <SubsidySummaryView s={objOf<SubsidySummary>(l.summary)} />}
      {shown.length > 0 ? <MiniTable cols={grid.cols} body={shown} /> : table && <p style={subStyle}>No rows.</p>}
      {shown.length > 0 && shown.length < total && <p style={noteStyle}>{`${shown.length} of ${total} rows shown.`}</p>}
      {str(l.note) && <p style={noteStyle}>{str(l.note)}</p>}
    </Card>
  );
}

function SaleSummaryView({ s }: { s: Loose<SaleSummary> }) {
  const crops = rowsOf<SaleCropTotal>(s.byCrop);
  return (
    <>
      <Stats
        items={[
          { label: "Tonnes sold", value: fmt(s.volumeT) },
          { label: "Revenue €", value: fmt(s.revenueEur, 0) },
          { label: "Average €/t", value: fmt(s.averagePriceEurT) },
        ]}
      />
      {crops.length > 1 && (
        <Facts
          items={crops.map((cr, i): [string, string | undefined] => [
            str(cr.cropName) ?? str(cr.cropCode) ?? `Crop ${i + 1}`,
            joinParts([withUnit(cr.volumeT, "t"), withUnit(cr.revenueEur, "€", 0), withUnit(cr.averagePriceEurT, "€/t")]),
          ])}
        />
      )}
    </>
  );
}

function SubsidySummaryView({ s }: { s: Loose<SubsidySummary> }) {
  const years = rowsOf<SubsidySummary["byYear"][number]>(s.byYear);
  return (
    <>
      <Stats items={[{ label: "Total €", value: fmt(s.totalEur, 0) }]} />
      {years.length > 1 && (
        <Facts items={years.map((y, i): [string, string | undefined] => [String(num(y.year) ?? `Year ${i + 1}`), withUnit(y.totalEur, "€", 0)])} />
      )}
    </>
  );
}

type GridCol = { head: string; left?: boolean };
type GridRow = { cells: (string | undefined)[]; muted?: boolean };

/** Columns and cells of the lookup table, per table. An unknown table has no grid. */
function lookupGrid(table: string | undefined, rawRows: unknown): { cols: GridCol[]; body: GridRow[] } {
  switch (table) {
    case "sale":
      return {
        cols: [{ head: "Date", left: true }, { head: "Crop", left: true }, { head: "t" }, { head: "€/t" }],
        body: rowsOf<SaleRow>(rawRows).map((r) => ({
          cells: [str(r.saleDate), str(r.cropName) ?? str(r.cropCode), fmt(r.volumeT), fmt(r.priceEurT)],
        })),
      };
    case "market_price":
      return {
        cols: [{ head: "Month", left: true }, { head: "Crop", left: true }, { head: "€/t" }],
        body: rowsOf<MarketPriceRow>(rawRows).map((r) => ({
          cells: [joinParts([monthText(r.year, r.month), r.forecast === true ? "forecast" : undefined], " "), str(r.cropName) ?? str(r.cropCode), fmt(r.priceEurT)],
          muted: r.forecast === true,
        })),
      };
    case "subsidy":
      return {
        cols: [{ head: "Year", left: true }, { head: "Scheme", left: true }, { head: "€" }],
        body: rowsOf<SubsidyRow>(rawRows).map((r) => ({ cells: [yearText(r.year), humanize(str(r.scheme)), fmt(r.amountEur, 0)] })),
      };
    case "farm_economics":
      return {
        cols: [{ head: "Year", left: true }, { head: "Output €" }, { head: "Inputs €" }, { head: "Net value €" }],
        body: rowsOf<FarmEconomicsRow>(rawRows).map((r) => ({
          cells: [yearText(r.year), fmt(r.totalOutputEur, 0), fmt(r.totalInputsEur, 0), fmt(r.farmNetValueAddedEur, 0)],
        })),
      };
    case "regional_benchmark":
      return {
        cols: [{ head: "Year", left: true }, { head: "Crops", left: true }, { head: "t/ha" }, { head: "N kg/ha" }, { head: "Irrigated" }],
        body: rowsOf<RegionalBenchmarkRow>(rawRows).map((r) => ({
          cells: [yearText(r.year), str(r.cropGroupName) ?? str(r.cropGroupCode), fmt(r.yieldTHa, 2), fmt(r.nKgHa, 0), share(r.irrigatedShare)],
        })),
      };
    default:
      return { cols: [], body: [] };
  }
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

type HeadTone = "act" | "ok" | "muted";

function Head({ title, badge, tone }: { title: string; badge?: string; tone?: HeadTone }) {
  const bg = tone === "act" ? v("act") : tone === "muted" ? v("sunk") : v("okSoft");
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <span style={{ fontFamily: font.display, fontWeight: 600, fontSize: 18 }}>{title}</span>
      {badge && (
        <span style={{ fontSize: 11, fontWeight: 600, borderRadius: radius.pill, padding: "3px 9px", whiteSpace: "nowrap", background: bg, color: tone === "act" ? v("bg") : v("ink") }}>{badge}</span>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${v("line")}`, paddingTop: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: v("ink2") }}>{title}</span>
      {children}
    </div>
  );
}

/** Label / value lines; a line without a value is left out. */
function Facts({ items }: { items: [string, string | undefined][] }) {
  const shown = items.filter((it): it is [string, string] => !!it[1]);
  if (shown.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {shown.map(([l, val], i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
          <span style={{ color: v("ink2") }}>{l}</span>
          <span style={{ fontWeight: 600, textAlign: "right" }}>{val}</span>
        </div>
      ))}
    </div>
  );
}

/** Small number tiles; a tile without a value is left out. */
function Stats({ items }: { items: { label: string; value?: string; tone?: "act" }[] }) {
  const shown = items.filter((it) => !!it.value);
  if (shown.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {shown.map((it) => (
        <div key={it.label} style={{ display: "flex", flexDirection: "column", minWidth: 64, padding: "6px 10px", borderRadius: radius.tile, background: it.tone === "act" ? v("actSoft") : v("sunk") }}>
          <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 18, color: it.tone === "act" ? v("act") : v("ink") }}>{it.value}</span>
          <span style={{ fontSize: 11, color: v("ink2") }}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

function MiniTable({ cols, body }: { cols: GridCol[]; body: GridRow[] }) {
  const cell = (k: number): React.CSSProperties => ({ textAlign: cols[k]?.left ? "left" : "right", padding: "4px 6px", whiteSpace: "nowrap", borderBottom: `1px solid ${v("line")}` });
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {cols.map((c, k) => (
              <th key={k} style={{ ...cell(k), fontSize: 11, fontWeight: 600, color: v("ink2") }}>{c.head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} style={{ color: r.muted ? v("ink2") : v("ink") }}>
              {r.cells.map((c, k) => (
                <td key={k} style={cell(k)}>{c ?? "–"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
const subStyle: React.CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.4, color: v("ink2") };
const noteStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.4, color: v("ink2") };
const btn: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 10, border: 0, fontWeight: 600, fontSize: 15, cursor: "pointer" };
const rowBtn: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", background: "transparent", border: 0, padding: "4px 0", color: v("ink"), cursor: "pointer", textAlign: "left", font: "inherit" };
const chip: React.CSSProperties = { border: `1px solid ${v("line")}`, background: v("sunk"), borderRadius: radius.pill, padding: "6px 12px", fontSize: 13, fontWeight: 600, color: v("ink"), cursor: "pointer" };
const tag: React.CSSProperties = { borderRadius: radius.pill, padding: "2px 8px", fontSize: 12, fontWeight: 600, background: v("sunk"), color: v("ink") };

// ---- loose output accessors (tool output is validated server-side) --------

type Rec = Record<string, unknown>;
const asObj = (x: unknown): Rec => (x && typeof x === "object" ? (x as Rec) : {});
const asArr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string | undefined => (typeof x === "string" ? x : undefined);
const num = (x: unknown): number | null => (typeof x === "number" ? x : null);

/** A shared contract as it may reach a card: every field may be missing or null. */
type Loose<T> = T extends readonly (infer U)[]
  ? readonly Loose<U>[]
  : T extends object
    ? { [K in keyof T]?: Loose<T[K]> | null }
    : T;

const isObj = (x: unknown): x is Rec => !!x && typeof x === "object" && !Array.isArray(x);
/** Reads a tool output with a shared type, every field optional. Not an object → {}. */
function objOf<T>(x: unknown): Loose<T> {
  return (isObj(x) ? x : {}) as Loose<T>;
}
/** The object items of an array (anything else → []). */
function rowsOf<T>(x: unknown): Loose<T>[] {
  return (Array.isArray(x) ? x.filter(isObj) : []) as unknown as Loose<T>[];
}
const texts = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
/** The map's text for a key, or undefined (unknown key, not a string). */
function pick<K extends string>(map: Record<K, string>, key: unknown): string | undefined {
  return typeof key === "string" && Object.hasOwn(map, key) ? map[key as K] : undefined;
}

// ---- display formatting (numbers come computed from the server) -----------

const fmt = (x: unknown, digits = 1): string | undefined =>
  typeof x === "number" && Number.isFinite(x) ? x.toLocaleString("en-GB", { maximumFractionDigits: digits }) : undefined;
const withUnit = (x: unknown, unit: string, digits = 1): string | undefined => {
  const n = fmt(x, digits);
  return n == null ? undefined : `${n} ${unit}`;
};
const positive = (x: unknown): string | undefined => (typeof x === "number" && x > 0 ? fmt(x) : undefined);
/** 0–1 share → "80 %". */
const share = (x: unknown): string | undefined => (typeof x === "number" ? withUnit(x * 100, "%", 0) : undefined);
const labeled = (name: string, value: string | undefined): string | undefined => (value ? `${name} ${value}` : undefined);
const joinParts = (parts: (string | undefined | null | false)[], sep = " · "): string => parts.filter(Boolean).join(sep);
const humanize = (s: string | undefined): string | undefined =>
  s ? (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, " ") : undefined;
const dose = (x: unknown, unit: unknown): string | undefined => {
  const n = fmt(x, 2);
  return n == null ? undefined : joinParts([n, str(unit)], " ");
};
/** "20–35 mm", or one bound alone. */
const range = (min: unknown, max: unknown, unit?: string): string | undefined => {
  const a = fmt(min);
  const b = fmt(max);
  const r = a && b ? (a === b ? a : `${a}–${b}`) : a ? `from ${a}` : b ? `up to ${b}` : undefined;
  return r && unit ? `${r} ${unit}` : r;
};
const threeParts = (a: unknown, b: unknown, c: unknown, unit: string): string | undefined => {
  const parts = [fmt(a, 0), fmt(b, 0), fmt(c, 0)];
  return parts.every(Boolean) ? `${parts.join(" / ")} ${unit}` : undefined;
};
const yearText = (y: unknown): string | undefined => (typeof y === "number" ? String(y) : undefined);
const monthText = (y: unknown, m: unknown): string | undefined =>
  typeof y === "number" && typeof m === "number" ? `${y}-${String(m).padStart(2, "0")}` : undefined;

const LABELS: Record<string, string> = {
  getFieldReport: "Field report",
  showWidget: "Chart",
  getFarmAdvice: "Farm advice",
  recordIrrigation: "Record watering",
  confirmIrrigation: "Confirmation",
  resolveField: "Fields",
  getWeather: "Weather",
  simulateScenario: "What-if",
  getIrrigationHistory: "History",
  getFieldDetails: "Field details",
  getFieldJournal: "Field journal",
  checkProductUse: "Product check",
  correctIrrigation: "Correct watering",
  lookupFarmData: "Farm data",
};
const label = (k: string): string => LABELS[k] ?? k;

const DECISIONS: Record<string, string> = {
  irrigate_today: "Irrigate",
  frost_hold: "Hold · frost",
  plan_irrigation: "Irrigate soon",
  wait_for_rain: "Wait for rain",
  crop_maturing: "Maturing · stop",
  no_irrigation: "No water needed",
  not_irrigable: "Rain-fed",
  outside_season: "Off season",
};
const decisionLabel = (d?: string): string => (d ? DECISIONS[d] ?? d : "");
/** Decision of a report, with the day for plan_irrigation ("Irrigate by Fri 17 Jul"). */
const reportLabel = (r: Rec): string =>
  str(r.decision) === "plan_irrigation"
    ? irrigateByLabel(str(r.asOf) ?? "", str(r.irrigateBy) ?? null)
    : decisionLabel(str(r.decision));
