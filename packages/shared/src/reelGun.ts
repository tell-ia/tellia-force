import { z } from "zod";

// Reel-gun (hose-reel travelling gun) equipment and the maths the cross-field plan
// needs: how long one takes to water a field, how many reel runs a field takes, how
// long to move between runs, and whether the pump can feed the guns at once.
//
// A reel gun pumps `flowM3h` and lays a wet strip `stripWidthM` wide as the hose
// (length `hoseLengthM`) winds in; a field wider than one strip needs several runs.
// Equipment is editable in the app (Farm equipment screen); farms differ on purpose.
// (For now the per-farm defaults live here / in local storage; moving them to the DB
// needs a schema migration.)

export const ReelGunModelSchema = z.object({
  id: z.string(),
  label: z.string(), // "Medium"
  brand: z.string(),
  name: z.string(), // commercial model
  hoseMm: z.number(), // hose diameter, mm
  hoseLengthM: z.number(), // hose length = run length, m
  flowM3h: z.number(), // pumped flow, m³/h
  stripWidthM: z.number(), // wet strip width, m
  efficiency: z.number(), // share reaching the roots
});
export type ReelGunModel = z.infer<typeof ReelGunModelSchema>;

// Catalog tiers with real commercial examples (Bauer Rainstar family); flow and strip
// are typical values, edited from the farm's spec sheet in the app.
export const REEL_GUN_CATALOG: ReelGunModel[] = [
  { id: "compact", label: "Compact", brand: "Bauer", name: "Rainstar A3", hoseMm: 90, hoseLengthM: 300, flowM3h: 25, stripWidthM: 60, efficiency: 0.75 },
  { id: "medium", label: "Medium", brand: "Bauer", name: "Rainstar E31", hoseMm: 110, hoseLengthM: 400, flowM3h: 50, stripWidthM: 72, efficiency: 0.75 },
  { id: "large", label: "Large", brand: "Bauer", name: "Rainstar E55", hoseMm: 125, hoseLengthM: 450, flowM3h: 70, stripWidthM: 90, efficiency: 0.78 },
  { id: "xl", label: "XL", brand: "Bauer", name: "Rainstar E55 XL", hoseMm: 140, hoseLengthM: 500, flowM3h: 95, stripWidthM: 100, efficiency: 0.78 },
];
const DEFAULT_MODEL_ID = "medium";

export function reelGunModel(id: string | undefined | null): ReelGunModel {
  return REEL_GUN_CATALOG.find((m) => m.id === id) ?? REEL_GUN_CATALOG.find((m) => m.id === DEFAULT_MODEL_ID)!;
}

// --- Farm equipment (editable; one or more reel guns, a shared pump, move time) ---

export const FarmEquipmentSchema = z.object({
  gunModelIds: z.array(z.string()).min(1), // one id per reel gun the farm runs
  pumpM3h: z.number(), // borehole/pump max for all guns together
  moveMinutes: z.number(), // unroll + set up + restart, per move between runs
});
export type FarmEquipment = z.infer<typeof FarmEquipmentSchema>;

/** Default equipment per demo farm (editable in the app; the three farms differ). */
export const DEFAULT_FARM_EQUIPMENT: Record<number, FarmEquipment> = {
  1: { gunModelIds: ["medium"], pumpM3h: 100, moveMinutes: 60 },
  2: { gunModelIds: ["large"], pumpM3h: 100, moveMinutes: 60 },
  3: { gunModelIds: ["large"], pumpM3h: 120, moveMinutes: 60 },
};
export function defaultFarmEquipment(farmId: number): FarmEquipment {
  return DEFAULT_FARM_EQUIPMENT[farmId] ?? { gunModelIds: ["medium"], pumpM3h: 100, moveMinutes: 60 };
}

// --- Maths -----------------------------------------------------------------

/** Hectares a gun can water in 24 h at 50 mm gross (1 ha × 50 mm = 500 m³). */
export function haPerDay(flowM3h: number): number {
  return (flowM3h * 24) / 500;
}

/** Reel runs to cover a field: strip × hose length per run, rounded up. */
export function runsForField(areaHa: number, model: ReelGunModel): number {
  const haPerRun = (model.stripWidthM * model.hoseLengthM) / 10_000;
  return Math.max(1, Math.ceil(areaHa / haPerRun));
}

/** Hours to apply `grossMm` over `areaHa` at the gun's flow. 1 mm over 1 ha = 10 m³. */
export function irrigationHours(areaHa: number, grossMm: number, flowM3h: number): number {
  if (flowM3h <= 0 || areaHa <= 0 || grossMm <= 0) return 0;
  return (areaHa * grossMm * 10) / flowM3h;
}

/** Great-circle distance between two field centroids, km. */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Hectares of a GeoJSON polygon field shape (spherical area, no dependency). Reads a
 *  Polygon / MultiPolygon geometry or a Feature wrapping one; returns null if it can't. */
export function polygonAreaHa(shape: unknown): number | null {
  const geom = (shape as { type?: string; geometry?: unknown; coordinates?: unknown } | null) ?? null;
  if (!geom || typeof geom !== "object") return null;
  const g = (geom.type === "Feature" ? geom.geometry : geom) as { type?: string; coordinates?: unknown } | null;
  if (!g || typeof g !== "object") return null;
  const R = 6378137; // WGS84 radius, m
  const rad = (d: number) => (d * Math.PI) / 180;
  const ringM2 = (ring: number[][]): number => {
    let total = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i]!;
      const b = ring[i + 1]!;
      if (a.length < 2 || b.length < 2) continue;
      total += rad(b[0]! - a[0]!) * (2 + Math.sin(rad(a[1]!)) + Math.sin(rad(b[1]!)));
    }
    return (total * R * R) / 2;
  };
  const polyM2 = (poly: number[][][]): number =>
    poly.reduce((s, ring, i) => s + (i === 0 ? Math.abs(ringM2(ring)) : -Math.abs(ringM2(ring))), 0);
  let m2 = 0;
  if (g.type === "Polygon") m2 = polyM2(g.coordinates as number[][][]);
  else if (g.type === "MultiPolygon") m2 = (g.coordinates as number[][][][]).reduce((s, p) => s + polyM2(p), 0);
  else return null;
  return m2 > 0 ? m2 / 10_000 : null;
}

const TOW_SPEED_KMH = 8; // tractor towing the reel on farm tracks

/** Hours to relocate the gun between fields: the farm's setup time + tow at ~8 km/h.
 *  Within one field (same centroid) it is just the setup time. */
export function moveHours(
  a: { lat: number; lon: number } | null,
  b: { lat: number; lon: number } | null,
  moveMinutes: number,
): number {
  const setup = moveMinutes / 60;
  if (!a || !b) return setup;
  return setup + haversineKm(a, b) / TOW_SPEED_KMH;
}
