import { SetFieldShapesBodySchema, SetFieldShapesResultSchema, type SetFieldShapesBody, type SetFieldShapesResult } from "@tellia/shared";
import { http } from "./core";
import { forgetTable } from "./data";

// LIVE: PUT /fields/shapes — store the outlines the farmer uploaded (a shapefile matched to
// their fields on the Fields screen). Every screen reading /data/field sees them at once.
export async function setFieldShapes(body: SetFieldShapesBody): Promise<SetFieldShapesResult> {
  const result = await http.put("/fields/shapes", SetFieldShapesBodySchema.parse(body), SetFieldShapesResultSchema);
  forgetTable("field");
  return result;
}
