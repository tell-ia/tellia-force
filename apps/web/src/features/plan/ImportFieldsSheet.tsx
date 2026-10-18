import { useRef, useState } from "react";
import { FileUp, Sparkles } from "lucide-react";
import { font, v } from "../../theme/tokens";
import { readFieldFile, type ImportedOutline } from "./fieldImport";

// Example exports for the demo farms (apps/web/public/samples/fields, built by
// scripts/make_field_shapefiles.py): each one's own field outlines, in its country's projection.
const SAMPLE_BY_FARM: Record<number, string> = {
  1: "trois-chenes_parcelles.zip",
  2: "los-olmos_recintos.zip",
  3: "ca-dei-pioppi_appezzamenti.zip",
};

export interface ReadFile {
  fileName: string;
  outlines: ImportedOutline[];
}

/** Pick the file with the field outlines (or the farm's example), read it, hand it back. */
export function ImportFieldsSheet({ farmId, onRead, onClose }: { farmId: number; onRead: (f: ReadFile) => void; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sample = SAMPLE_BY_FARM[farmId];

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

  const useSample = () => {
    if (!sample) return;
    void read(sample, async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/fields/${sample}`);
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
        {sample && (
          <button type="button" disabled={busy} onClick={useSample} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, borderRadius: 14, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), fontWeight: 600, fontSize: 14, cursor: busy ? "default" : "pointer" }}>
            <Sparkles size={16} /> Try the example file
            <span style={{ fontWeight: 400, color: v("ink2"), fontSize: 12 }}>{sample}</span>
          </button>
        )}
        {sample && (
          <a href={`${import.meta.env.BASE_URL}samples/fields/${sample}`} download style={{ alignSelf: "center", fontSize: 12, color: v("ink2") }}>
            Download the example
          </a>
        )}
        {error && <span role="alert" style={{ fontSize: 13, color: v("act"), lineHeight: 1.4 }}>{error}</span>}
      </div>
    </div>
  );
}
