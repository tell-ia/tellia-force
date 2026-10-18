import { assertEquals } from "@std/assert";
import type { FieldGeometry } from "@tellia/shared/app";
import { restoredColumns, uploadedShape } from "../src/modules/fields/shapes.ts";

const box = { type: "Polygon", coordinates: [[[1, 48], [1.01, 48], [1.01, 48.01], [1, 48.01], [1, 48]]] };
const seeded = { id: 7, shape_geojson: box, centroid_lon: 1.005, centroid_lat: 48.005 };
const outline = (d: number): FieldGeometry => ({
  type: "Polygon",
  coordinates: [[[1 + d, 48], [1.02, 48.001], [1.015, 48.012], [1 + d, 48]]],
});
const at = new Date("2026-10-18T10:00:00Z");

Deno.test("an upload keeps the seeded outline, and removing it puts that back", () => {
  const stored = uploadedShape(seeded, outline(0), "a.zip", at);
  assertEquals(stored.properties.original, { shape: box, centroid: [1.005, 48.005] });
  const row = { id: 7, shape_geojson: stored, centroid_lon: 1.01, centroid_lat: 48.004 };
  assertEquals(restoredColumns(row), { shape_geojson: box, centroid_lon: 1.005, centroid_lat: 48.005 });
});

Deno.test("a second upload still remembers the seeded outline, not the first upload", () => {
  const first = uploadedShape(seeded, outline(0), "a.zip", at);
  const second = uploadedShape({ ...seeded, shape_geojson: first, centroid_lon: 1.01 }, outline(0.001), "b.zip", at);
  assertEquals(second.properties.fileName, "b.zip");
  assertEquals(second.properties.original, { shape: box, centroid: [1.005, 48.005] });
});

Deno.test("a seeded outline has nothing to remove", () => {
  assertEquals(restoredColumns(seeded), null);
});
