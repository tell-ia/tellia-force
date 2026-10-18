import { useRef, useState } from "react";
import { Download, FileUp, Sparkles } from "lucide-react";
import { useFarm } from "../../app/FarmContext";
import { font, v } from "../../theme/tokens";
import { readFieldFile, type ImportedOutline } from "./fieldImport";

// Example exports for the demo farms (apps/web/public/samples/fields, built by
// scripts/make_field_shapefiles.py): each one's own field outlines, in its country's projection.
const SAMPLES: { farmId: number; file: string; projection: string }[] = [
  { farmId: 1, file: "trois-chenes_parcelles.zip", projection: "Lambert-93" },
  { farmId: 2, file: "los-olmos_recintos.zip", projection: "UTM 30N" },
  { farmId: 3, file: "ca-dei-pioppi_appezzamenti.zip", projection: "WGS84" },
];
const sampleUrl = (file: string) => `${import.meta.env.BASE_URL}samples/fields/${file}`;

export interface ReadFile {
  fileName: string;
  outlines: ImportedOutline[];
}

/** Pick the file with the field outlines (or the farm's example), read it, hand it back. */
export function ImportFieldsSheet({ farmId, onRead, onClose }: { farmId: number; onRead: (f: ReadFile) => void; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { farms } = useFarm();
  // This farm's example first: the others match none of its fields (handy to show the skip).
  const samples = [...SAMPLES].sort((a, b) => Number(b.farmId === farmId) - Number(a.farmId === farmId));

  const read = async (fileName: string, bytes: () => Promise<ArrayBuffer>) => {
    setBusy(true);
    setError(null);
    try {
      onRead({ fileName, outlines: await readFieldFile(fileName, await bytes()) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onPick = (file: File | undefined) => {
    if (file) void read(file.name, () => file.arrayBuffer());
    if (input.current) input.current.value = ""; // picking the same file again still fires
  };

  const useSample = (file: string) => {
    void read(file, async () => {
      const res = await fetch(sampleUrl(file));
      if (!res.ok) throw new Error("The example file is missing from this build.");
      return res.arrayBuffer();
    });
  };

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", zIndex: 1000 }}>
      <button type="button" aria-label="Close" onClick={onClose} style={{ position: "absolute", inset: 0, border: 0, padding: 0, background: "rgba(15, 24, 19, 0.48)", cursor: "pointer" }} />
      <div role="dialog" aria-label="Upload your fields" style={{ position: "relative", background: v("bg"), borderRadius: "22px 22px 0 0", padding: "10px 20px calc(28px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, background: v("line") }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontFamily: font.display, fontWeight: 600, fontSize: 28, lineHeight: 1 }}>Upload your fields</div>
          <div style={{ fontSize: 13, color: v("ink2"), lineHeight: 1.45 }}>
            The outlines from your PAC declaration: a zipped shapefile (.shp, .dbf, .prj) or a GeoJSON. Each outline goes to the field with the same name, or the one at the same spot. You check them on the map before saving.
          </div>
        </div>

        <input ref={input} type="file" accept=".zip,.geojson,.json,application/zip,application/geo+json,application/json" hidden onChange={(e) => onPick(e.target.files?.[0])} />
        <button type="button" disabled={busy} onClick={() => input.current?.click()} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 52, borderRadius: 14, border: 0, background: v("brand"), color: v("bg"), fontWeight: 600, fontSize: 15, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
          <FileUp size={18} /> {busy ? "Reading…" : "Choose a file"}
        </button>
        <div role="group" aria-label="Example files" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: v("ink2") }}>
            <Sparkles size={13} /> Or try an example
          </span>
          {samples.map((x) => {
            const mine = x.farmId === farmId;
            const farmName = farms.find((f) => f.id === x.farmId)?.name ?? `Farm ${x.farmId}`;
            return (
              <div key={x.file} style={{ display: "flex", alignItems: "stretch", gap: 6 }}>
                <button type="button" disabled={busy} onClick={() => useSample(x.file)} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 2, minHeight: 52, padding: "6px 12px", borderRadius: 12, border: mine ? `2px solid ${v("brand")}` : `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), cursor: busy ? "default" : "pointer", textAlign: "left" }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>
                    {farmName}
                    {mine && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: v("brand") }}>this farm</span>}
                  </span>
                  <span style={{ fontSize: 12, color: v("ink2"), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{x.file} · {x.projection}</span>
                </button>
                <a href={sampleUrl(x.file)} download aria-label={`Download ${x.file}`} style={{ flex: "none", width: 48, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink2") }}>
                  <Download size={16} />
                </a>
              </div>
            );
          })}
        </div>
        {error && <span role="alert" style={{ fontSize: 13, color: v("act"), lineHeight: 1.4 }}>{error}</span>}
      </div>
    </div>
  );
}
