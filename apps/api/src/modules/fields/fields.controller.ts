import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  RemoveFieldShapesQuerySchema,
  RemoveFieldShapesResultSchema,
  SetFieldShapesBodySchema,
  SetFieldShapesResultSchema,
} from "@tellia/shared/app";
import { validate } from "../../core/validate";
import { db } from "../../supabase";
import { centroid, restoredColumns, type ShapeRow, uploadedShape } from "./shapes";

// Field outlines uploaded from the Fields screen (a shapefile the farmer exported from their
// PAC declaration). The app parses and matches the file; this stores the outlines on the farm's
// own fields, with their centroid, and can take them off again. Each upload keeps the outline it
// replaced, so removing it restores the seeded shape exactly. The recorded area is left as
// declared. Mount at `/fields`.

export const fields = new Hono();

async function farmRows(farmId: number, ids?: number[]): Promise<ShapeRow[]> {
  let q = db.from("field").select("id, shape_geojson, centroid_lat, centroid_lon").eq("farm_id", farmId);
  if (ids) q = q.in("id", ids);
  const { data, error } = await q;
  if (error) throw new HTTPException(500, { message: error.message });
  return (data ?? []) as ShapeRow[];
}

async function updateAll(farmId: number, updates: { id: number; cols: Record<string, unknown> }[]): Promise<number[]> {
  const results = await Promise.all(
    updates.map(({ id, cols }) => db.from("field").update(cols).eq("id", id).eq("farm_id", farmId).select("id").maybeSingle()),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new HTTPException(500, { message: failed.error.message });
  return results.flatMap((r) => (r.data ? [r.data.id as number] : []));
}

// PUT /fields/shapes { farmId, fileName, shapes: [{ fieldId, geometry }] }
fields.put("/shapes", validate("json", SetFieldShapesBodySchema), async (c) => {
  const { farmId, fileName, shapes } = c.req.valid("json");
  // Only this farm's fields are read, so a field of another farm is never touched.
  const rows = new Map((await farmRows(farmId, shapes.map((s) => s.fieldId))).map((r) => [r.id, r]));
  const now = new Date();
  const updated = await updateAll(
    farmId,
    shapes.flatMap(({ fieldId, geometry }) => {
      const row = rows.get(fieldId);
      if (!row) return [];
      const [lon, lat] = centroid(geometry);
      return [{ id: fieldId, cols: { shape_geojson: uploadedShape(row, geometry, fileName, now), centroid_lat: lat, centroid_lon: lon } }];
    }),
  );
  return c.json({ data: SetFieldShapesResultSchema.parse({ updated }) });
});

// DELETE /fields/shapes?farmId=1[&fieldId=7] — remove uploaded outlines (seeded ones stay).
fields.delete("/shapes", validate("query", RemoveFieldShapesQuerySchema), async (c) => {
  const { farmId, fieldId } = c.req.valid("query");
  const rows = await farmRows(farmId, fieldId != null ? [fieldId] : undefined);
  const restored = await updateAll(
    farmId,
    rows.flatMap((row) => {
      const cols = restoredColumns(row);
      return cols ? [{ id: row.id, cols }] : [];
    }),
  );
  return c.json({ data: RemoveFieldShapesResultSchema.parse({ restored }) });
});
