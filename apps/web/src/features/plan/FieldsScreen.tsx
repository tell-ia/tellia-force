import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ArrowLeft, Upload } from "lucide-react";
import type { FarmToday } from "@tellia/shared";
import { irrigationHours, polygonAreaHa, reelGunModel, runsForField } from "@tellia/shared";
import { fetchRpgParcels, getFarmToday, list, setFieldShapes } from "../../lib/api";
import { matchOutlines, type ImportPlan } from "./fieldImport";
import { ImportFieldsSheet, type ReadFile } from "./ImportFieldsSheet";
import { useAsync } from "../../lib/useAsync";
import { useFarm } from "../../app/FarmContext";
import { useEquipment } from "../../app/EquipmentContext";
import { navigate } from "../../app/router";
import { font, radius, v } from "../../theme/tokens";
import { Label } from "../../components/ui/primitives";
import { Loader } from "../../components/ui/Loader";

const GROSS = 40; // reference gross dose for the run-time estimate, mm (reel-gun per-pass cap)

interface FieldRow {
  id: number;
  name: string;
  areaHa: number;
  computedHa: number | null;
  irrigable: boolean;
  ring: [number, number][] | null; // outer ring [lon,lat]
  centroid: [number, number] | null; // [lon,lat]
  crop: string;
  preview?: boolean; // outline from a file being reviewed, not saved yet
}

/** The dataset's placeholder shapes are axis-aligned boxes; an uploaded outline never is. */
function isSchematicBox(ring: [number, number][] | null): boolean {
  if (!ring || ring.length < 3 || ring.length > 5) return false;
  return new Set(ring.map((p) => p[0])).size <= 2 && new Set(ring.map((p) => p[1])).size <= 2;
}

function outerRing(shape: unknown): [number, number][] | null {
  const geom = (shape as { type?: string; geometry?: unknown; coordinates?: unknown }) ?? null;
  if (!geom || typeof geom !== "object") return null;
  const g = (geom.type === "Feature" ? geom.geometry : geom) as { type?: string; coordinates?: unknown };
  if (!g) return null;
  let ring: unknown;
  if (g.type === "Polygon") ring = (g.coordinates as unknown[])?.[0];
  else if (g.type === "MultiPolygon") ring = ((g.coordinates as unknown[])?.[0] as unknown[])?.[0];
  if (!Array.isArray(ring)) return null;
  return (ring as number[][]).filter((p) => p.length >= 2).map((p) => [p[0]!, p[1]!]);
}

export function FieldsScreen() {
  const { farm } = useFarm();
  const { equipmentFor } = useEquipment();
  const [sel, setSel] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [review, setReview] = useState<{ fileName: string; plan: ImportPlan } | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [version, setVersion] = useState(0); // bumped after a save → reload the fields

  const { data, loading } = useAsync<{ farmId: number; rows: FieldRow[] } | null>(
    async () => {
      if (!farm) return null;
      const [fields, today] = await Promise.all([
        list("field", { limit: 100 }),
        getFarmToday(farm).catch(() => null as FarmToday | null),
      ]);
      const cropOf = new Map((today?.parcels ?? []).map((p) => [p.id, p.cropName]));
      const rows: FieldRow[] = fields.data
        .filter((f) => f.farm_id === farm.id)
        .map((f) => ({
          id: f.id,
          name: f.name,
          areaHa: f.area_ha ?? 0,
          computedHa: polygonAreaHa(f.shape_geojson),
          irrigable: !!f.irrigable,
          ring: outerRing(f.shape_geojson),
          centroid: f.centroid_lon != null && f.centroid_lat != null ? [f.centroid_lon, f.centroid_lat] : null,
          crop: cropOf.get(f.id) ?? "",
        }));

      // Snap each placeholder box to a real nearby RPG parcel of a similar area → real outlines.
      // Uploaded outlines are the farmer's own: kept as they are.
      const boxes = rows.filter((r) => isSchematicBox(r.ring));
      if (boxes.length > 0) {
        const cx = boxes.reduce((s, r) => s + r.ring!.reduce((a, p) => a + p[0], 0) / r.ring!.length, 0) / boxes.length;
        const cy = boxes.reduce((s, r) => s + r.ring!.reduce((a, p) => a + p[1], 0) / r.ring!.length, 0) / boxes.length;
        try {
          const parcels = await fetchRpgParcels(cx, cy);
          if (parcels.length > 0) {
            const used = new Set<number>();
            for (const row of [...boxes].sort((a, b) => b.areaHa - a.areaHa)) {
              let best = -1;
              let bd = Infinity;
              parcels.forEach((p, i) => {
                if (used.has(i)) return;
                const d = Math.abs(p.areaHa - row.areaHa);
                if (d < bd) { bd = d; best = i; }
              });
              if (best >= 0) {
                used.add(best);
                row.ring = parcels[best]!.ring;
                const c = polygonAreaHa({ type: "Polygon", coordinates: [parcels[best]!.ring] });
                if (c) row.computedHa = c;
              }
            }
          }
        } catch {
          /* keep the boxes if the RPG service is unreachable */
        }
      }
      return { farmId: farm.id, rows };
    },
    [farm?.id, version],
  );

  const gun = farm ? reelGunModel(equipmentFor(farm.id).gunModelIds[0]) : reelGunModel("medium");
  const saved = data && data.farmId === farm?.id ? data.rows : []; // a reload keeps the screen up
  // While reviewing a file, the map and the numbers show its outlines in place of the saved ones.
  const rows = useMemo(() => {
    if (!review) return saved;
    const byField = new Map(review.plan.matches.map((m) => [m.field.id, m.outline]));
    return saved.map((r) => {
      const o = byField.get(r.id);
      return o ? { ...r, ring: outerRing(o.geometry), computedHa: o.areaHa, preview: true } : r;
    });
  }, [saved, review]);
  const selected = rows.find((r) => r.id === sel) ?? rows[0] ?? null;

  useEffect(() => {
    setReview(null);
    setNotice(null);
  }, [farm?.id]);

  const onRead = ({ fileName, outlines }: ReadFile) => {
    setSheetOpen(false);
    setNotice(null);
    setReview({ fileName, plan: matchOutlines(outlines, saved.map((r) => ({ id: r.id, name: r.name, centroid: r.centroid }))) });
  };

  const save = async () => {
    if (!farm || !review || saving) return;
    setSaving(true);
    try {
      const { updated } = await setFieldShapes({
        farmId: farm.id,
        shapes: review.plan.matches.map((m) => ({ fieldId: m.field.id, geometry: m.outline.geometry })),
      });
      setReview(null);
      setNotice({ ok: true, text: `${updated.length} field outline${updated.length === 1 ? "" : "s"} saved.` });
      setVersion((n) => n + 1);
    } catch (e) {
      setNotice({ ok: false, text: `Not saved: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, padding: "12px 16px calc(28px + env(safe-area-inset-bottom))" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" onClick={() => navigate("today")} aria-label="Back to Today" style={{ width: 44, height: 44, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: v("ink"), borderRadius: 22, background: v("sunk"), border: 0, cursor: "pointer" }}>
          <ArrowLeft size={22} />
        </button>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <Label>Fields</Label>
          <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 26 }}>{farm?.name ?? "Farm"}</span>
        </div>
        <button type="button" onClick={() => setSheetOpen(true)} disabled={!farm} aria-label="Upload your fields" style={{ height: 40, padding: "0 12px", borderRadius: 20, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <Upload size={15} /> Upload
        </button>
        <button type="button" onClick={() => navigate("equipment")} style={{ height: 40, padding: "0 12px", borderRadius: 20, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Equipment</button>
      </div>

      {loading && rows.length === 0 && <Loader />}
      {notice && <span role="status" style={{ fontSize: 13, fontWeight: 600, color: notice.ok ? v("brand") : v("act") }}>{notice.text}</span>}
      {rows.length > 0 && (
        <>
          <FieldsMap rows={rows} selId={selected?.id ?? null} onSelect={setSel} />

          {review && <ReviewCard fileName={review.fileName} plan={review.plan} saving={saving} onSave={save} onCancel={() => setReview(null)} />}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {rows.map((r) => {
              const on = r.id === (selected?.id ?? null);
              return (
                <button key={r.id} type="button" onClick={() => setSel(r.id)} style={{ minHeight: 40, padding: "0 12px", borderRadius: 12, fontSize: 13, fontWeight: 600, color: v("ink"), cursor: "pointer", display: "flex", alignItems: "center", gap: 6, background: v("surface"), border: on ? `2px solid ${v("ink")}` : `1px solid ${v("line")}` }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: r.irrigable ? v("water") : v("line") }} />{r.name}
                </button>
              );
            })}
          </div>

          {selected && (
            <section style={{ background: v("surface"), border: `1px solid ${v("line")}`, borderRadius: radius.section, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 26, lineHeight: 1 }}>{selected.name}</span>
                <span style={{ fontSize: 13, color: v("ink2") }}>{selected.crop}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                <Stat caption="Area · recorded" value={`${selected.areaHa.toFixed(2)} ha`} />
                <Stat caption="Computed on the shape" value={selected.computedHa != null ? `${selected.computedHa.toFixed(2)} ha` : "—"} sub={deltaLabel(selected)} />
              </div>
              {selected.irrigable ? <RunStats row={selected} gun={gun} /> : (
                <span style={{ fontSize: 14, color: v("ink2") }}>Not irrigated — not in the irrigation plan.</span>
              )}
            </section>
          )}

          <button type="button" onClick={() => navigate("plan")} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 52, borderRadius: 14, border: 0, background: v("brand"), color: v("bg"), fontWeight: 600, fontSize: 15, cursor: "pointer" }}>See the irrigation plan →</button>
        </>
      )}

      {sheetOpen && farm && <ImportFieldsSheet farmId={farm.id} onRead={onRead} onClose={() => setSheetOpen(false)} />}
    </div>
  );
}

/** What the uploaded file will change, before anything is saved. */
function ReviewCard({ fileName, plan, saving, onSave, onCancel }: { fileName: string; plan: ImportPlan; saving: boolean; onSave: () => void; onCancel: () => void }) {
  const byPlace = plan.matches.filter((m) => m.by === "place").length;
  return (
    <section aria-label="Uploaded outlines" style={{ background: v("surface"), border: `2px dashed ${v("water")}`, borderRadius: radius.section, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: v("ink2") }}>From {fileName}</span>
        <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>
          {plan.matches.length} of your fields get their real outline
        </span>
        <span style={{ fontSize: 13, color: v("ink2"), lineHeight: 1.45 }}>
          Dashed on the map. {byPlace > 0 ? `${byPlace} matched by where it sits, the rest by name. ` : "Matched by name. "}
          {plan.unmatched.length > 0 && `${plan.unmatched.length} outline${plan.unmatched.length === 1 ? " is" : "s are"} not one of this farm's fields and will be skipped. `}
          {plan.untouched.length > 0 && `${plan.untouched.length} field${plan.untouched.length === 1 ? " keeps its" : "s keep their"} current outline.`}
        </span>
      </div>
      {plan.matches.length > 0 && (
        <details style={{ fontSize: 13 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, minHeight: 32, display: "flex", alignItems: "center" }}>See the {plan.matches.length} fields</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 4 }}>
            {plan.matches.map((m) => (
              <div key={m.field.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>
                  {m.field.name}
                  {m.by === "place" && m.outline.name && <span style={{ color: v("ink2") }}> ← “{m.outline.name}”</span>}
                </span>
                <span style={{ color: v("ink2"), whiteSpace: "nowrap" }}>{m.outline.areaHa != null ? `${m.outline.areaHa.toFixed(2)} ha` : ""}</span>
              </div>
            ))}
          </div>
        </details>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={onCancel} disabled={saving} style={{ flex: 1, minHeight: 48, borderRadius: 14, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), fontWeight: 600, fontSize: 14, cursor: "pointer" }}>Cancel</button>
        <button type="button" onClick={onSave} disabled={saving || plan.matches.length === 0} style={{ flex: 2, minHeight: 48, borderRadius: 14, border: 0, background: v("brand"), color: v("bg"), fontWeight: 600, fontSize: 14, cursor: saving ? "default" : "pointer", opacity: saving || plan.matches.length === 0 ? 0.6 : 1 }}>
          {saving ? "Saving…" : `Save ${plan.matches.length} outline${plan.matches.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </section>
  );
}

function deltaLabel(r: FieldRow): string {
  if (r.computedHa == null || r.areaHa <= 0) return "";
  const d = ((r.computedHa - r.areaHa) / r.areaHa) * 100;
  return Math.abs(d) < 0.5 ? "matches the record" : `${d > 0 ? "+" : ""}${d.toFixed(1)}% vs record`;
}

function RunStats({ row, gun }: { row: FieldRow; gun: ReturnType<typeof reelGunModel> }) {
  const runs = runsForField(row.areaHa, gun);
  const perRunH = irrigationHours(row.areaHa / runs, GROSS, gun.flowM3h);
  const totalH = perRunH * runs; // moves add a little on top
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: v("ink2") }}>
        {gun.name} · {gun.flowM3h} m³/h · {gun.stripWidthM} m strip
      </span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, textAlign: "center" }}>
        <Tile value={`${runs}`} label="runs" />
        <Tile value={`${Math.round(perRunH)} h`} label="per run" />
        <Tile value={`${Math.round(totalH)} h`} label="whole field" />
      </div>
      <span style={{ fontSize: 13, color: v("ink2"), lineHeight: 1.5 }}>
        {GROSS} mm gross × {(row.areaHa / runs).toFixed(2)} ha = {Math.round((row.areaHa / runs) * GROSS * 10).toLocaleString()} m³ per run (1 mm on 1 ha = 10 m³). At {gun.flowM3h} m³/h: {perRunH.toFixed(1)} h per run. Whole field ≈ {(totalH / 24).toFixed(1)} days plus moves.
      </span>
    </div>
  );
}

function Stat({ caption, value, sub }: { caption: string; value: string; sub?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, background: v("sunk"), borderRadius: 10, padding: "8px 10px" }}>
      <span style={{ fontSize: 11, color: v("ink2") }}>{caption}</span>
      <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 22, lineHeight: 1 }}>{value}</span>
      {sub && <span style={{ fontSize: 11, color: v("ink2") }}>{sub}</span>}
    </div>
  );
}
function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, border: `1px solid ${v("line")}`, borderRadius: 10, padding: "8px 4px" }}>
      <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 24, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 11, color: v("ink2") }}>{label}</span>
    </div>
  );
}

// Real satellite basemap (ESRI World Imagery, free, no token) with the field shapes
// overlaid at their real coordinates: the farmer's uploaded outlines, else the dataset's
// placeholder boxes snapped to a real RPG parcel (France only).
function FieldsMap({ rows, selId, onSelect }: { rows: FieldRow[]; selId: number | null; onSelect: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.GeoJSON | null>(null);
  const withRing = rows.filter((r) => r.ring && r.ring.length > 2);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current, { zoomControl: false, attributionControl: false, dragging: true });
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19 }).addTo(map);
    map.setView([48.03, 1.82], 13);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layerRef.current) {
      layerRef.current.remove();
      layerRef.current = null;
    }
    if (withRing.length === 0) return;
    const fc = {
      type: "FeatureCollection" as const,
      features: withRing.map((r) => ({
        type: "Feature" as const,
        properties: { id: r.id },
        geometry: { type: "Polygon" as const, coordinates: [r.ring!.map(([lon, lat]) => [lon, lat])] },
      })),
    };
    const gj = L.geoJSON(fc as never, {
      style: (f) => {
        const r = rows.find((x) => x.id === (f?.properties as { id: number }).id);
        const on = r?.id === selId;
        return { color: on ? "#F6F3E8" : r?.preview ? "#F6F3E8" : "#182E22", weight: on ? 3 : r?.preview ? 2 : 1.5, dashArray: r?.preview ? "6 4" : undefined, fillColor: r?.irrigable ? "#3F9384" : "#B9B29C", fillOpacity: on ? 0.6 : 0.35 };
      },
      onEachFeature: (f, layer) => layer.on("click", () => onSelect((f.properties as { id: number }).id)),
    }).addTo(map);
    layerRef.current = gj;
    const sel = withRing.find((r) => r.id === selId);
    try {
      if (sel) {
        map.flyToBounds(L.latLngBounds(sel.ring!.map(([lon, lat]) => [lat, lon] as [number, number])), { padding: [48, 48], maxZoom: 17, duration: 0.6 });
      } else {
        map.fitBounds(gj.getBounds(), { padding: [24, 24], maxZoom: 16 });
      }
    } catch {
      /* no bounds */
    }
  }, [rows, selId, onSelect, withRing.length]);

  return <div ref={ref} style={{ height: 240, flex: "none", borderRadius: radius.section, overflow: "hidden", background: "#E3E0CF", border: `1px solid ${v("line")}` }} />;
}
