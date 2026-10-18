import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type FieldGeometry, SetFieldShapesBodySchema, SetFieldShapesResultSchema } from "@tellia/shared/app";
import { validate } from "../../core/validate";
import { db } from "../../supabase";

// Field outlines uploaded from the Fields screen (a shapefile the farmer exported from their
// PAC declaration). The app parses and matches the file; this only stores the outlines on the
// farm's own fields, with their centroid. The recorded area is left as declared. Mount at `/fields`.

export const fields = new Hono();

/** Mean of the outer ring's vertices (the closing point counted once), [lon, lat]. */
function centroid(g: FieldGeometry): [number, number] {
  const ring = g.type === "Polygon" ? g.coordinates[0]! : g.coordinates[0]![0]!;
  const pts = ring.slice(0, -1);
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

fields.put("/shapes", validate("json", SetFieldShapesBodySchema), async (c) => {
  const { farmId, shapes } = c.req.valid("json");
  const results = await Promise.all(
    shapes.map(({ fieldId, geometry }) => {
      const [lon, lat] = centroid(geometry);
      return db
        .from("field")
        .update({ shape_geojson: geometry, centroid_lat: lat, centroid_lon: lon })
        .eq("id", fieldId)
        .eq("farm_id", farmId) // a field of another farm is never touched
        .select("id")
        .maybeSingle();
    }),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new HTTPException(500, { message: failed.error.message });
  const updated = results.flatMap((r) => (r.data ? [r.data.id as number] : []));
  return c.json({ data: SetFieldShapesResultSchema.parse({ updated }) });
});
