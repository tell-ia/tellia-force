import {
  RemoveFieldShapesResultSchema,
  SetFieldShapesBodySchema,
  SetFieldShapesResultSchema,
  type RemoveFieldShapesResult,
  type SetFieldShapesBody,
  type SetFieldShapesResult,
} from "@tellia/shared";
import { http } from "./core";
import { forgetTable } from "./data";

// LIVE: PUT /fields/shapes — store the outlines the farmer uploaded (a shapefile matched to
// their fields on the Fields screen). Every screen reading /data/field sees them at once.
export async function setFieldShapes(body: SetFieldShapesBody): Promise<SetFieldShapesResult> {
  const result = await http.put("/fields/shapes", SetFieldShapesBodySchema.parse(body), SetFieldShapesResultSchema);
  forgetTable("field");
  return result;
}

// LIVE: DELETE /fields/shapes — take uploaded outlines off (one field, or all of the farm's);
// each field goes back to the outline it had before. Seeded outlines are never removed.
export async function removeFieldShapes(farmId: number, fieldId?: number): Promise<RemoveFieldShapesResult> {
  const qs = new URLSearchParams({ farmId: String(farmId), ...(fieldId != null ? { fieldId: String(fieldId) } : {}) });
  const result = await http.del(`/fields/shapes?${qs}`, RemoveFieldShapesResultSchema);
  forgetTable("field");
  return result;
}
