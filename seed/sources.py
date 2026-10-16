"""Read the seed inputs: hackathon CSV files (with DuckDB), Open-Meteo weather and the E-Phy register."""

import csv
import io
import json
import urllib.parse
import urllib.request
import zipfile
from datetime import date, timedelta
from pathlib import Path

import duckdb

SEASON_TABLES = ['planting', 'harvest', 'plant_protection', 'fertilisation', 'irrigation']


class Datasets:
    def __init__(self, root):
        self.root = Path(root)
        if not (self.root / 'synthetic' / 'synthetic_holding.csv').exists():
            raise SystemExit(f'DATASETS_DIR does not look like the hackathon datasets folder: {self.root}')
        self.con = duckdb.connect()

    def _csv(self, rel):
        path = str(self.root / rel).replace("'", "''")
        return f"read_csv('{path}', nullstr='\\N', union_by_name=true, sample_size=-1)"

    def rows(self, sql, params=None):
        cur = self.con.execute(sql, params or [])
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    def synthetic(self, name, multi=False):
        return self._csv(f'synthetic/synthetic_{name}_*.csv' if multi else f'synthetic/synthetic_{name}.csv')

    # ── the farm ──
    def holding(self, farm_id):
        rows = self.rows(f"select * from {self.synthetic('holding')} where holding_id = ?", [farm_id])
        if not rows:
            raise SystemExit(f'Farm {farm_id} not found in synthetic_holding.csv')
        return rows[0]

    def parcels(self, farm_id):
        return self.rows(f"select * from {self.synthetic('parcel')} where holding_id = ? order by parcel_id", [farm_id])

    def by_holding(self, name, farm_id, order='1'):
        return self.rows(f"select * from {self.synthetic(name)} where holding_id = ? order by {order}", [farm_id])

    def soil(self, parcel_ids):
        return self.rows(f"select * from {self.synthetic('soil')} where parcel_id in (select unnest(?))", [parcel_ids])

    def donor_parcels(self, nuts3, farm_type, exclude_farm):
        """Parcels of other farms of the same type and region, grouped by crop."""
        rows = self.rows(f"""
            select p.parcel_id, p.crop_current from {self.synthetic('parcel')} p
            join {self.synthetic('holding')} h using (holding_id)
            where h.nuts3 = ? and h.farm_type_tf8 = ? and h.holding_id <> ?
            order by p.parcel_id""", [nuts3, farm_type, exclude_farm])
        out = {}
        for r in rows:
            out.setdefault(r['crop_current'], []).append(r['parcel_id'])
        return out

    def season_records(self, parcel_ids):
        """planting, harvest, sprays, fertiliser and irrigation rows, keyed by (parcel_id, year)."""
        out = {}
        for t in SEASON_TABLES:
            for r in self.rows(f"select * from {self.synthetic(t, True)} where parcel_id in (select unnest(?))",
                               [parcel_ids]):
                out.setdefault((r['parcel_id'], r['year']), {}).setdefault(t, []).append(r)
        return out

    def irrigated_years(self, parcel_ids):
        """Number of years each parcel was irrigated in the dataset."""
        rows = self.rows(f"select parcel_id, sum(irrigated)::int n from {self.synthetic('irrigation', True)} "
                         "where parcel_id in (select unnest(?)) group by 1", [parcel_ids])
        return {r['parcel_id']: r['n'] for r in rows}

    def market_prices(self, crops):
        return self.rows(f"select * from {self.synthetic('market_price')} where product in (select unnest(?))", [crops])

    # ── the region (real data) ──
    def region(self, nuts3):
        name = self.rows(f"select nuts_name from {self._csv('combined/combined_holding_region.csv')} "
                         "where nuts3_id = ? limit 1", [nuts3])
        normals = self.rows(f"select * from {self._csv('combined/combined_region_climate_normals.csv')} "
                            "where nuts3_id = ?", [nuts3])
        soil = self.rows(f"select * from {self._csv('soil/soil_soil_topsoil_ready.csv')} where nuts3_id = ?", [nuts3])
        return (name[0]['nuts_name'] if name else nuts3), (normals[0] if normals else {}), (soil[0] if soil else {})

    def weather(self, nuts3):
        return self.rows(f"select * from {self._csv('weather/weather_daily_*.csv')} where nuts3_id = ? order by date",
                         [nuts3])

    def weather_years(self, nuts3, years):
        """Daily weather of a region for some years only. Faster than weather(): one CSV file per year."""
        return [w for y in years for w in self.rows(
            f"select * from {self._csv(f'weather/weather_daily_{y}.csv')} where nuts3_id = ? order by date", [nuts3])]

    def benchmark(self, nuts3, groups):
        return self.rows(f"""
            select y.*, p.pesticide_total_kg_ai_ha, p.herbicide_kg_ai_ha, p.fungicide_kg_ai_ha,
                   p.insecticide_kg_ai_ha, p.pesticide_reference_period
            from {self._csv('crop/crop_yield_npk_ready.csv')} y
            left join {self._csv('crop/crop_pesticide_ready.csv')} p
              on p.nuts3_id = y.nuts3_id and p.crop_group_code = y.crop_group_code
            where y.nuts3_id = ? and y.crop_group_code in (select unnest(?))
            order by y.crop_group_code, y.year""", [nuts3, groups])


# ── Open-Meteo (real weather after 2024) ──

OPEN_METEO_DAILY = ('temperature_2m_min,temperature_2m_mean,temperature_2m_max,precipitation_sum,'
                    'relative_humidity_2m_mean,wind_speed_10m_mean,shortwave_radiation_sum,et0_fao_evapotranspiration')


def _get_json(url, params):
    full = url + '?' + urllib.parse.urlencode(params)
    with urllib.request.urlopen(full, timeout=60) as resp:
        return json.load(resp)


def _open_meteo_rows(data, source):
    d = data['daily']
    rows = []
    for i, day in enumerate(d['time']):
        tmean, et0 = d['temperature_2m_mean'][i], d['et0_fao_evapotranspiration'][i]
        if tmean is None or et0 is None:
            continue
        rows.append(dict(
            date=date.fromisoformat(day), tmin_c=d['temperature_2m_min'][i], tmean_c=tmean,
            tmax_c=d['temperature_2m_max'][i], precip_mm=d['precipitation_sum'][i] or 0.0,
            rh_pct=d['relative_humidity_2m_mean'][i], wind_m_s=d['wind_speed_10m_mean'][i] or 0.0,
            radiation_mj_m2=d['shortwave_radiation_sum'][i], et0_mm=et0, source=source))
    return rows


def open_meteo(lat, lon, start, end):
    """Observed daily weather at a point. The archive (ERA5) lags a few days; the forecast API fills the gap."""
    common = dict(latitude=round(lat, 4), longitude=round(lon, 4), timezone='Europe/Paris',
                  wind_speed_unit='ms', daily=OPEN_METEO_DAILY)
    rows = _open_meteo_rows(_get_json('https://archive-api.open-meteo.com/v1/archive',
                                      dict(common, start_date=start.isoformat(), end_date=end.isoformat())),
                            'Open-Meteo archive (ERA5), CC BY 4.0')
    last = max((r['date'] for r in rows), default=start - timedelta(days=1))
    if last < end:
        try:
            recent = _open_meteo_rows(_get_json('https://api.open-meteo.com/v1/forecast',
                                                dict(common, past_days=min(92, (end - last).days + 1), forecast_days=1)),
                                      'Open-Meteo forecast model (recent days), CC BY 4.0')
            rows += [r for r in recent if last < r['date'] <= end]
        except OSError as e:
            print(f'  ! Open-Meteo recent days not loaded: {e}')
    return rows


# ── E-Phy: French register of crop protection products (Anses, data.gouv.fr) ──

EPHY_DATASET_ID = '575e9fac88ee38072a640390'
EPHY_FILE = 'usages_des_produits_autorises_utf8.csv'


def ephy_usages(cache_dir):
    """Authorised product uses. Downloads the latest CSV zip once, then reuses the cached copy."""
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    try:
        meta = _get_json(f'https://www.data.gouv.fr/api/1/datasets/{EPHY_DATASET_ID}/', {})
        res = [r for r in meta['resources'] if r['title'].startswith('decisionamm-intrant-format-csv')
               and r['title'].endswith('-utf8.zip')]
        res.sort(key=lambda r: r['last_modified'], reverse=True)
        target = cache_dir / Path(res[0]['title']).name
        if not target.exists():
            print(f'  downloading {target.name}')
            urllib.request.urlretrieve(res[0]['url'], target)
    except (OSError, KeyError, IndexError) as e:
        print(f'  ! E-Phy download failed ({e}), using the cached copy')
    zips = sorted(cache_dir.glob('decisionamm-intrant-format-csv-*-utf8.zip'))
    if not zips:
        raise SystemExit('No E-Phy file. Check the internet connection and run again.')
    with zipfile.ZipFile(zips[-1]) as z:
        text = z.read(EPHY_FILE).decode('utf-8')
    return list(csv.DictReader(io.StringIO(text), delimiter=';')), zips[-1].name
