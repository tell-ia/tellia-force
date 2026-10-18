import { type FieldGeometry, type UploadedFieldShape, UploadedFieldShapeSchema } from "@tellia/shared/app";

// Pure helpers for the uploaded field outlines (no DB): what to store, what to put back.

export interface ShapeRow {
  id: number;
  shape_geojson: unknown;
  centroid_lat: number | null;
  centroid_lon: number | null;
}

/** Mean of the outer ring's vertices (the closing point counted once), [lon, lat]. */
export function centroid(g: FieldGeometry): [number, number] {
  const ring = g.type === "Polygon" ? g.coordinates[0]! : g.coordinates[0]![0]!;
  const pts = ring.slice(0, -1);
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

/** The stored upload, keeping the pre-upload outline (a re-upload keeps the first original). */
export function uploadedShape(row: ShapeRow, geometry: FieldGeometry, fileName: string, at: Date): UploadedFieldShape {
  const prev = UploadedFieldShapeSchema.safeParse(row.shape_geojson);
  const original = prev.success ? prev.data.properties.original : {
    shape: row.shape_geojson ?? null,
    centroid: row.centroid_lon != null && row.centroid_lat != null ? [row.centroid_lon, row.centroid_lat] as [number, number] : null,
  };
  return { type: "Feature", geometry, properties: { source: "upload", fileName, uploadedAt: at.toISOString(), original } };
}

/** The columns that put a field back on its pre-upload outline; null when it has no upload. */
export function restoredColumns(row: ShapeRow) {
  const up = UploadedFieldShapeSchema.safeParse(row.shape_geojson);
  if (!up.success) return null;
  const { shape, centroid } = up.data.properties.original;
  return { shape_geojson: shape, centroid_lon: centroid?.[0] ?? null, centroid_lat: centroid?.[1] ?? null };
}
