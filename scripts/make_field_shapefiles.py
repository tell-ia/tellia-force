# /// script
# requires-python = ">=3.11"
# dependencies = ["pyshp>=2.3", "pyproj>=3.6"]
# ///
"""Build one example field shapefile (.zip) per demo farm, for the Fields screen's upload.

    uv run scripts/make_field_shapefiles.py [--api http://localhost:8000]

Reads the farms and fields from the API (/data/farm, /data/field) and writes
apps/web/public/samples/fields/<farm>.zip, the kind of export a farmer gets from their
PAC declaration: one polygon per field with its name, in the country's usual projection.

- France (Trois Chênes): real parcel outlines from the IGN RPG 2021, the one nearest each
  field with a similar area, in Lambert-93 (EPSG:2154) like a Telepac export.
- Spain (Los Olmos): believable irregular outlines on each field's spot, in ETRS89 / UTM 30N
  (EPSG:25830) like SIGPAC.
- Italy (Ca' dei Pioppi): same, in plain WGS84 (EPSG:4326).

Attributes: NOM (field name, matched by the app), SURF_HA (area of the outline), ID_PARCEL.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import random
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

import shapefile
from pyproj import CRS, Geod, Transformer

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "apps/web/public/samples/fields"
GEOD = Geod(ellps="WGS84")

# farm id -> (file name, EPSG, use real RPG outlines)
FARMS = {
    1: ("trois-chenes_parcelles", 2154, True),
    2: ("los-olmos_recintos", 25830, False),
    3: ("ca-dei-pioppi_appezzamenti", 4326, False),
}


def api_url(arg: str | None) -> str:
    if arg:
        return arg.rstrip("/")
    for line in (ROOT / "apps/web/.env").read_text().splitlines():
        if line.startswith("VITE_API_URL="):
            return line.split("=", 1)[1].strip().rstrip("/")
    raise SystemExit("pass --api or set VITE_API_URL in apps/web/.env")


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=60) as res:
        return json.load(res)


def area_ha(ring: list[tuple[float, float]]) -> float:
    lons, lats = zip(*ring)
    return abs(GEOD.polygon_area_perimeter(lons, lats)[0]) / 10_000


def centroid(ring: list[tuple[float, float]]) -> tuple[float, float]:
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def rpg_parcels(lon: float, lat: float, half: float = 0.05) -> list[list[tuple[float, float]]]:
    """Outer rings of the RPG 2021 parcels around a point (IGN Géoplateforme WFS)."""
    bbox = f"{lon - half:.5f},{lat - half:.5f},{lon + half:.5f},{lat + half:.5f},urn:ogc:def:crs:OGC:1.3:CRS84"
    url = (
        "https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature"
        "&typeNames=RPG.2021:parcelles_graphiques&outputFormat=application/json&srsName=CRS:84"
        "&count=1000&bbox=" + urllib.parse.quote(bbox)
    )
    rings = []
    for f in get_json(url).get("features", []):
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        outer = max((p[0] for p in polys), key=len)
        rings.append([(p[0], p[1]) for p in outer])
    return rings


def snap_to_rpg(fields: list[dict]) -> dict[int, list[tuple[float, float]]]:
    """Each field gets the unused RPG parcel nearest its spot whose area is within 30 %."""
    lon = sum(f["centroid_lon"] for f in fields) / len(fields)
    lat = sum(f["centroid_lat"] for f in fields) / len(fields)
    parcels = [(r, area_ha(r), centroid(r)) for r in rpg_parcels(lon, lat)]
    used: set[int] = set()
    out = {}
    for f in sorted(fields, key=lambda f: -f["area_ha"]):
        best, best_d = None, math.inf
        for i, (_, a, (clon, clat)) in enumerate(parcels):
            if i in used or abs(a - f["area_ha"]) / f["area_ha"] > 0.3:
                continue
            d = GEOD.inv(f["centroid_lon"], f["centroid_lat"], clon, clat)[2]
            if d < best_d:
                best, best_d = i, d
        if best is not None:
            used.add(best)
            out[f["id"]] = parcels[best][0]
    return out


def irregular_outline(f: dict) -> list[tuple[float, float]]:
    """A field-like polygon on the field's spot: a rotated, skewed rectangle with one cut
    corner, scaled so its area matches the recorded one. Seeded by the field id."""
    rnd = random.Random(f["id"])
    aspect = rnd.uniform(1.4, 2.6)
    angle = math.radians(rnd.uniform(-35, 35))
    # unit shape in metres (width 1), corners jittered, one corner cut
    pts = [(-aspect / 2, -0.5), (aspect / 2, -0.5), (aspect / 2, 0.5), (-aspect / 2, 0.5)]
    pts = [(x + rnd.uniform(-0.12, 0.12), y + rnd.uniform(-0.08, 0.08)) for x, y in pts]
    cut = rnd.randrange(4)
    a, b = pts[cut], pts[(cut + 1) % 4]
    c = pts[(cut - 1) % 4]
    pts[cut : cut + 1] = [
        (a[0] + (c[0] - a[0]) * 0.25, a[1] + (c[1] - a[1]) * 0.25),
        (a[0] + (b[0] - a[0]) * 0.2, a[1] + (b[1] - a[1]) * 0.2),
    ]
    # shoelace area of the unit shape → scale to the target hectares
    unit = abs(sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts)))) / 2
    k = math.sqrt(f["area_ha"] * 10_000 / unit)
    lat0 = math.radians(f["centroid_lat"])
    ring = []
    for x, y in pts:
        xr = (x * math.cos(angle) - y * math.sin(angle)) * k
        yr = (x * math.sin(angle) + y * math.cos(angle)) * k
        ring.append((
            round(f["centroid_lon"] + xr / (111_320 * math.cos(lat0)), 7),
            round(f["centroid_lat"] + yr / 110_574, 7),
        ))
    return ring + [ring[0]]


def clockwise(ring: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Shapefile outer rings run clockwise."""
    s = sum((b[0] - a[0]) * (b[1] + a[1]) for a, b in zip(ring, ring[1:]))
    return ring if s > 0 else ring[::-1]


def write_zip(name: str, epsg: int, rows: list[tuple[dict, list[tuple[float, float]]]]) -> Path:
    to_crs = Transformer.from_crs(4326, epsg, always_xy=True)
    shp, shx, dbf = io.BytesIO(), io.BytesIO(), io.BytesIO()
    with shapefile.Writer(shp=shp, shx=shx, dbf=dbf, shapeType=shapefile.POLYGON, encoding="utf-8") as w:
        w.field("NOM", "C", 80)
        w.field("SURF_HA", "N", 10, 2)
        w.field("ID_PARCEL", "C", 24)
        for f, ring in rows:
            xy = [to_crs.transform(lon, lat) for lon, lat in clockwise(ring)]
            prec = 7 if epsg == 4326 else 2
            w.poly([[(round(x, prec), round(y, prec)) for x, y in xy]])
            w.record(f["name"], round(area_ha(ring), 2), f["source_parcel_id"] or "")
    prj = CRS.from_epsg(epsg).to_wkt("WKT1_ESRI")
    path = OUT / f"{name}.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"{name}.shp", shp.getvalue())
        z.writestr(f"{name}.shx", shx.getvalue())
        z.writestr(f"{name}.dbf", dbf.getvalue())
        z.writestr(f"{name}.prj", prj)
        z.writestr(f"{name}.cpg", "UTF-8")
    return path


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--api", help="API base URL (default: VITE_API_URL from apps/web/.env)")
    api = api_url(p.parse_args().api)
    fields = get_json(f"{api}/data/field?limit=100")["data"]
    OUT.mkdir(parents=True, exist_ok=True)
    for farm_id, (name, epsg, use_rpg) in FARMS.items():
        mine = sorted((f for f in fields if f["farm_id"] == farm_id), key=lambda f: f["id"])
        snapped = snap_to_rpg(mine) if use_rpg else {}
        rows = [(f, snapped.get(f["id"]) or irregular_outline(f)) for f in mine]
        path = write_zip(name, epsg, rows)
        print(f"{path.relative_to(ROOT)}: {len(rows)} fields, EPSG:{epsg}, {len(snapped)} real RPG outlines")


if __name__ == "__main__":
    main()
