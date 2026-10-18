import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { FieldGeometry } from "@tellia/shared";
import { matchOutlines, normalizeName, outlinesFromGeoJson, readFieldFile, type FarmFieldRef } from "./fieldImport";

const square = (lon: number, lat: number, d = 0.002): FieldGeometry => ({
  type: "Polygon",
  coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]],
});

const fields: FarmFieldRef[] = [
  { id: 1, name: "La Grande Pièce", centroid: [1.785, 48.046] },
  { id: 2, name: "Le Moulin", centroid: [1.795, 48.05] },
  { id: 3, name: "Le Puits", centroid: [1.7915, 48.0552] },
];

describe("normalizeName", () => {
  it("ignores case, accents and separators", () => {
    expect(normalizeName("LA GRANDE PIECE")).toBe(normalizeName("La Grande Pièce"));
    expect(normalizeName("la_grande-pièce ")).toBe("la grande piece");
  });
});

describe("outlinesFromGeoJson", () => {
  it("reads polygons and their name attribute, skips points", () => {
    const out = outlinesFromGeoJson({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { NOM: "Le Moulin" }, geometry: square(1.794, 48.049) },
        { type: "Feature", properties: { name: "x" }, geometry: { type: "Point", coordinates: [1, 2] } },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("Le Moulin");
    expect(out[0]!.areaHa).toBeGreaterThan(0);
  });
});

describe("matchOutlines", () => {
  it("matches by name first, then by place, and lists the rest", () => {
    const plan = matchOutlines(
      [
        { name: "LA GRANDE PIECE", geometry: square(1.7, 48.0), areaHa: 4 }, // far away, but the name matches
        { name: "Parcelle 7", geometry: square(1.794, 48.049), areaHa: 8 }, // no name match, sits on Le Moulin
        { name: "Bois", geometry: square(2.5, 47.0), areaHa: 3 }, // nowhere near
      ],
      fields,
    );
    expect(plan.matches.map((m) => [m.field.id, m.by])).toEqual([[1, "name"], [2, "place"]]);
    expect(plan.unmatched.map((o) => o.name)).toEqual(["Bois"]);
    expect(plan.untouched.map((f) => f.id)).toEqual([3]);
  });
});

describe("readFieldFile", () => {
  it("reads the Trois Chênes sample shapefile, reprojected from Lambert-93", async () => {
    const buf = readFileSync(resolve(__dirname, "../../../public/samples/fields/trois-chenes_parcelles.zip"));
    const out = await readFieldFile("trois-chenes_parcelles.zip", buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(out).toHaveLength(11);
    const piece = out.find((o) => o.name === "La Grande Pièce")!;
    const [lon, lat] = piece.geometry.type === "Polygon" ? piece.geometry.coordinates[0]![0]! : [0, 0];
    expect(lon).toBeGreaterThan(1.7);
    expect(lon).toBeLessThan(1.9);
    expect(lat).toBeGreaterThan(48);
    expect(lat).toBeLessThan(48.1);
  });

  it("says what to do with a bare .shp", async () => {
    await expect(readFieldFile("fields.shp", new ArrayBuffer(8))).rejects.toThrow(/Zip the .shp/);
  });
});
