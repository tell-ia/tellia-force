// Real French field outlines from the IGN Géoplateforme RPG WFS (Registre Parcellaire
// Graphique, 2021). Free, no key, CORS-open. The demo farms are fictional, so we snap
// each field to a real nearby parcel of a similar area to get a believable outline.

export interface RpgParcel {
  ring: [number, number][]; // outer ring, [lon, lat]
  areaHa: number;
  cropCode: string;
}

function largestRing(geom: { type?: string; coordinates?: unknown } | null): [number, number][] | null {
  if (!geom) return null;
  const toRing = (poly: unknown): [number, number][] | null => {
    const outer = (poly as number[][][])?.[0];
    if (!Array.isArray(outer)) return null;
    return outer.filter((p) => p.length >= 2).map((p) => [p[0]!, p[1]!]);
  };
  if (geom.type === "Polygon") return toRing(geom.coordinates);
  if (geom.type === "MultiPolygon") {
    const polys = geom.coordinates as unknown[];
    let best: [number, number][] | null = null;
    for (const poly of polys) {
      const r = toRing(poly);
      if (r && (!best || r.length > best.length)) best = r;
    }
    return best;
  }
  return null;
}

export async function fetchRpgParcels(lon: number, lat: number, halfDeg = 0.06): Promise<RpgParcel[]> {
  const bbox = [
    (lon - halfDeg).toFixed(5),
    (lat - halfDeg).toFixed(5),
    (lon + halfDeg).toFixed(5),
    (lat + halfDeg).toFixed(5),
    "urn:ogc:def:crs:OGC:1.3:CRS84",
  ].join(",");
  const url =
    "https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature" +
    "&typeNames=RPG.2021:parcelles_graphiques&outputFormat=application/json&srsName=CRS:84&count=400&bbox=" +
    encodeURIComponent(bbox);
  const res = await fetch(url);
  if (!res.ok) return [];
  const gj = (await res.json()) as { features?: { geometry: never; properties?: Record<string, unknown> }[] };
  const out: RpgParcel[] = [];
  for (const f of gj.features ?? []) {
    const ring = largestRing(f.geometry);
    if (!ring || ring.length < 4) continue;
    out.push({ ring, areaHa: Number(f.properties?.surf_parc) || 0, cropCode: String(f.properties?.code_cultu ?? "") });
  }
  return out;
}
