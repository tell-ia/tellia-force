import { FieldGeometrySchema, polygonAreaHa, type FieldGeometry } from "@tellia/shared";

// Reading a farmer's field file (a zipped shapefile from their PAC declaration, or GeoJSON)
// and matching its outlines to the farm's fields: by name first, then by place for the rest.

export interface ImportedOutline {
  name: string; // the name in the file ("" when it has none)
  geometry: FieldGeometry; // WGS84 [lon, lat]
  areaHa: number | null;
}

export interface FarmFieldRef {
  id: number;
  name: string;
  centroid: [number, number] | null; // [lon, lat]
}

export interface OutlineMatch {
  field: FarmFieldRef;
  outline: ImportedOutline;
  by: "name" | "place";
}

export interface ImportPlan {
  matches: OutlineMatch[];
  unmatched: ImportedOutline[]; // in the file, not on this farm
  untouched: FarmFieldRef[]; // on this farm, not in the file
}

// Attribute names that carry a field's name in PAC / GIS exports (FR, ES, IT, EN).
const NAME_KEYS = ["nom", "nom_parcel", "name", "nombre", "nome", "label", "libelle", "parcelle", "field"];
const PLACE_MATCH_M = 400; // an outline this close to a field's spot is that field

/** "La Grande Pièce" / "LA GRANDE PIECE" / "la_grande-pièce" → "la grande piece". */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function nameOf(props: Record<string, unknown> | null | undefined): string {
  if (!props) return "";
  const entries = Object.entries(props);
  for (const key of NAME_KEYS) {
    const hit = entries.find(([k, val]) => k.toLowerCase() === key && typeof val === "string" && val.trim());
    if (hit) return String(hit[1]).trim();
  }
  return "";
}

/** Mean of the outer ring's vertices, [lon, lat]. */
export function outlineCentroid(g: FieldGeometry): [number, number] {
  const ring = g.type === "Polygon" ? g.coordinates[0]! : g.coordinates[0]![0]!;
  const pts = ring.length > 1 ? ring.slice(0, -1) : ring;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

function metres(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad);
  const y = (b[1] - a[1]) * rad;
  return Math.hypot(x, y) * 6_371_000;
}

/** Polygon outlines out of any GeoJSON (FeatureCollection, list of them, Feature, geometry). */
export function outlinesFromGeoJson(gj: unknown): ImportedOutline[] {
  const out: ImportedOutline[] = [];
  const visit = (node: unknown, props?: Record<string, unknown> | null) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n));
    const n = node as { type?: string; features?: unknown[]; geometry?: unknown; properties?: Record<string, unknown> | null };
    if (n.type === "FeatureCollection") return n.features?.forEach((f) => visit(f));
    if (n.type === "Feature") return visit(n.geometry, n.properties);
    const geometry = FieldGeometrySchema.safeParse(node);
    if (geometry.success) out.push({ name: nameOf(props), geometry: geometry.data, areaHa: polygonAreaHa(geometry.data) });
  };
  visit(gj);
  return out;
}

/**
 * Read a field file: a .zip shapefile (.shp + .dbf, reprojected from its .prj, e.g. Lambert-93)
 * or a .geojson / .json. Throws a sentence the farmer can read when it is neither.
 */
export async function readFieldFile(fileName: string, bytes: ArrayBuffer): Promise<ImportedOutline[]> {
  const lower = fileName.toLowerCase();
  let outlines: ImportedOutline[];
  if (lower.endsWith(".zip")) {
    const { default: shp } = await import("shpjs"); // only loaded when someone uploads
    outlines = outlinesFromGeoJson(await shp(bytes).catch(() => {
      throw new Error("This zip has no readable shapefile (.shp, .dbf and .prj).");
    }));
  } else if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
    try {
      outlines = outlinesFromGeoJson(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
      throw new Error("This file is not valid GeoJSON.");
    }
  } else if (lower.endsWith(".shp")) {
    throw new Error("Zip the .shp together with its .dbf and .prj, then upload the .zip.");
  } else {
    throw new Error("Upload a zipped shapefile (.zip) or a GeoJSON file.");
  }
  if (outlines.length === 0) throw new Error("No field outlines (polygons) in this file.");
  return outlines;
}

/** Pair each outline with one of the farm's fields: same name first, then the nearest spot. */
export function matchOutlines(outlines: ImportedOutline[], fields: FarmFieldRef[]): ImportPlan {
  const byName = new Map(fields.map((f) => [normalizeName(f.name), f]));
  const taken = new Set<number>();
  const matches: OutlineMatch[] = [];
  const rest: ImportedOutline[] = [];
  for (const outline of outlines) {
    const field = outline.name ? byName.get(normalizeName(outline.name)) : undefined;
    if (field && !taken.has(field.id)) {
      taken.add(field.id);
      matches.push({ field, outline, by: "name" });
    } else rest.push(outline);
  }
  const unmatched: ImportedOutline[] = [];
  for (const outline of rest) {
    const c = outlineCentroid(outline.geometry);
    let best: FarmFieldRef | null = null;
    let bestM = PLACE_MATCH_M;
    for (const f of fields) {
      if (taken.has(f.id) || !f.centroid) continue;
      const m = metres(c, f.centroid);
      if (m < bestM) {
        best = f;
        bestM = m;
      }
    }
    if (best) {
      taken.add(best.id);
      matches.push({ field: best, outline, by: "place" });
    } else unmatched.push(outline);
  }
  return { matches, unmatched, untouched: fields.filter((f) => !taken.has(f.id)) };
}
