#!/usr/bin/env python3
"""Load the demo farms into the farm database (Supabase / PostgreSQL).

    python seed.py --dry-run   build everything and print a summary, write nothing
    python seed.py             create the tables and load the data (empty database)
    python seed.py --reset     drop the farm tables first, then rebuild them
    python seed.py --only-fao  load only the FAO-56 reference tables and crop_phase_gdd (add --reset to reload)

Settings come from seed/.env (see .env.example and README.md).

What it does:
  1. Reads the demo farms (FARM_IDS) from the hackathon synthetic tables.
  2. Fixes what is not realistic: adds a crop rotation, moves sprays and
     fertiliser to the right crop stages using real weather, removes sprays
     after harvest, splits yearly irrigation into watering turns.
  3. Replaces the fake product names with real products from E-Phy (French farms only).
  4. Adds real weather (AgERA5 to 2024, then Open-Meteo), regional benchmarks,
     the FAO-56 reference tables from FAO_DIR (Marceau's files), and crop_phase_gdd built from them.
  5. Writes everything in one transaction: if something fails, nothing changes.
"""

import argparse
import csv
import math
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv

import agronomy as ag
from sources import Datasets, ephy_usages, open_meteo

ROOT = Path(__file__).resolve().parent  # the seed/ folder
SCHEMA = Path(__file__).resolve().parent / 'schema.sql'
SCHEMA_FAO = Path(__file__).resolve().parent / 'schema_fao.sql'

# Insert order (parents before children). --reset drops exactly these.
TABLES = ['region', 'crop_ref', 'crop_stage', 'weather_daily', 'regional_benchmark', 'market_price',
          'product', 'product_use', 'farm', 'member', 'irrigation_system', 'field', 'soil_analysis', 'crop_season', 'message',
          'operation', 'operation_input', 'alert', 'document', 'sale', 'subsidy', 'farm_economics']
VIEWS = ['v_field_current', 'v_spray_register', 'v_nutrients_by_season']
# FAO-56 reference tables (Marceau's files): table -> CSV file in FAO_DIR. Columns come from schema_fao.sql.
FAO_FILES = {
    'fao56_crop_stages': 'fao56_crop_stages.csv',
    'fao56_kc': 'fao56_kc.csv',
    'fao56_root_depletion': 'fao56_root_depletion.csv',
    'fao56_soil_water': 'fao56_soil_water.csv',
    'fao33_ky': 'fao33_ky.csv',
    'stage_thresholds_gdd': 'stage_thresholds_gdd.csv',
}
# stage_thresholds_gdd rows that belong to one variety group, by the start of anchor_stage.
EARLINESS_ANCHORS = {
    'MAIZ': [('Female flowering - very early', 'very_early'), ('Female flowering - early', 'early'),
             ('Female flowering - half-early flint-dent', 'half_early_flint_dent'),
             ('Female flowering - half-early dent', 'half_early_dent'),
             ('Female flowering - half-late', 'half_late'), ('Female flowering - late and very late', 'late')],
    'SUNF': [('Full cycle sowing to harvest - early varieties', 'early'),
             ('Full cycle - half-early varieties', 'half_early'), ('Full cycle - normal varieties', 'normal')],
}
FAO_DERIVED = {'gdd_from_sowing_default_num', 'earliness_group'}
# All FAO tables in insert order: the CSV tables, then crop_phase_gdd, built by the seed from them.
FAO_TABLES = list(FAO_FILES) + ['crop_phase_gdd']
# crop_phase_gdd: where no published anchor exists, FAO-56 day lengths become degree-days on one real season
# (Marceau's recipe, fao56/fao56_README.md section 1): Loiret weather from the hackathon files, our calendar.
REFERENCE_NUTS3 = 'FRB06'
REFERENCE_SEASONS = {'COWT': (date(2019, 10, 25), date(2020, 7, 20)),   # (sowing, harvest)
                     'SUNF': (date(2020, 4, 20), date(2020, 9, 15)),
                     'RAPE': (date(2019, 8, 31), date(2020, 7, 5))}
# Maize and sunflower: sensitive from 100 degree-days before flowering to the end of the grain-abortion risk
# (flowering + 200 to 250, Isagri). p capped at 0.45 inside (fao56_root_depletion notes).
FLOWERING_WINDOW = (100, 250, 0.45)
WHEAT_END_OF_FLOWERING = 1768   # Isagri; only in the note of the wheat "Start of flowering" anchor
WHEAT_P_SENSITIVE = 0.45        # heading to flowering (fao56_root_depletion note)
BARLEY_FACTOR = 0.9             # no published barley sums: wheat anchors minus about 10 % (proxy)
RAPE_WINDOW = (300, 0.50)       # flowering + 300 degree-days, p lowered to 0.50 (fao56_root_depletion note)
SERIAL_TABLES = ['product', 'product_use', 'farm', 'member', 'irrigation_system', 'field', 'soil_analysis', 'crop_season', 'message',
                 'operation', 'operation_input', 'alert', 'document', 'sale', 'subsidy']

# ── Invented details (the demo farms are fictional) ──
DEFAULT_FARMS = ['FARM-02580', 'FARM-07712', 'FARM-08422']   # Loiret (FR), Valladolid (ES), Bologna (IT)
# One reel gun per farm, shared by its irrigable fields (typical values, invented for the demo).
REEL_GUN = dict(name='Reel gun 1', system_type='reel_gun', efficiency=0.75, dose_min_mm=20, dose_max_mm=40,
                round_days=3, notes='Hose reel with a water gun, shared by the irrigable fields.', origin='invented')
# A sunflower field counts as irrigable when the dataset irrigated it at least this many years out of 10.
IRRIGABLE_SUNF_MIN_YEARS = 5
# Names and settings per farm. `members` are paired with the dataset's workers from oldest to youngest.
# `rank` sets the member id order inside the farm (1 = main contact). `jobs` = operations recorded under
# that person (default: the main contact). `fields` follow the dataset parcel order.
FARM_PROFILES = {
    'FARM-02580': dict(
        name='GAEC des Trois Chênes', legal_form='GAEC', language='fr', timezone='Europe/Paris',
        layout_origin=(48.020, 1.760),  # south-west corner of the field layout, Beauce part of Loiret
        earliness={'MAIZ': 'early', 'SUNF': 'early'},
        fields=['Le Moulin', 'La Grande Pièce', 'Les Longues Raies', 'Le Bois Carré', 'La Mare', 'Le Petit Clos',
                'Les Sablons', 'La Croix Blanche', 'Le Chemin Vert', 'La Vallée', 'Le Puits'],
        members=[
            dict(rank=3, full_name='Monique Lefèvre', certiphyto=False, notes='Accounts and CAP declarations.'),
            dict(rank=2, full_name='Sophie Lefèvre', certiphyto=True, jobs=['spraying'], notes='Does the spraying.'),
            dict(rank=1, full_name='Claire Lefèvre', certiphyto=True, main_contact=True,
                 jobs=['sowing', 'fertilisation'], notes='Runs the farm. Main contact. Does sowing and fertiliser.'),
            dict(rank=4, full_name='Camille Lefèvre', certiphyto=True, jobs=['irrigation'],
                 notes='Irrigation and crop scouting.'),
        ]),
    'FARM-07712': dict(
        name='SAT Los Olmos', legal_form='SAT', language='es', timezone='Europe/Madrid',
        layout_origin=(41.580, -4.950),  # irrigated plain west of Valladolid
        earliness={'MAIZ': 'late', 'SUNF': 'normal'},
        fields=['El Molino', 'La Vega', 'Los Cascajares', 'El Pozo', 'La Hoya', 'Las Eras', 'El Prado',
                'La Cañada', 'Los Llanos', 'El Soto'],
        members=[
            dict(rank=3, full_name='Carmen Martín', certiphyto=False, notes='Accounts and CAP declarations.'),
            dict(rank=2, full_name='Javier Martín', certiphyto=True, jobs=['spraying'], notes='Does the spraying.'),
            dict(rank=4, full_name='Lucía Martín', certiphyto=True, jobs=['irrigation'], notes='Irrigation.'),
            dict(rank=1, full_name='Elena Martín', certiphyto=True, main_contact=True,
                 jobs=['sowing', 'fertilisation'], notes='Runs the farm. Main contact. Does sowing and fertiliser.'),
        ]),
    'FARM-08422': dict(
        name="Società Agricola Ca' dei Pioppi", legal_form='Società agricola semplice', language='it',
        timezone='Europe/Rome',
        layout_origin=(44.600, 11.480),  # plain north-east of Bologna
        earliness={'MAIZ': 'late', 'SUNF': 'normal'},
        fields=['Il Mulino', 'La Chiusa', 'Il Pozzo', 'Campo Lungo', 'La Fornace', 'Le Valli', 'Il Canale',
                'La Corte', 'Campo Grande', 'Il Gelso', 'La Bassa', 'Il Prato', 'La Torre', 'Il Fosso'],
        members=[
            dict(rank=1, full_name='Marco Bianchi', certiphyto=True, main_contact=True,
                 jobs=['sowing', 'fertilisation'], notes='Runs the farm. Main contact. Does sowing and fertiliser.'),
            dict(rank=2, full_name='Paolo Bianchi', certiphyto=True, jobs=['spraying'], notes='Does the spraying.'),
            dict(rank=3, full_name='Giulia Bianchi', certiphyto=False, jobs=['irrigation'],
                 notes='Irrigation and accounts.'),
        ]),
}
DOSE_FACTORS = [0.5, 0.6, 0.7, 0.75, 0.8, 1.0]

stats = Counter()
warnings = []


def num(v):
    try:
        return float(str(v).replace(',', '.')) if v not in (None, '') else None
    except ValueError:
        return None


def r2(v):
    return None if v is None else round(float(v), 2)


# ───────────────────────── reference data ─────────────────────────

def build_weather(ds, nuts3, location, today):
    """Daily weather of a region. AgERA5 to 2024; then Open-Meteo at `location` (lat, lon), or the region centroid."""
    rows, centroid = [], None
    for w in ds.weather(nuts3):
        centroid = centroid or (w['centroid_latitude'], w['centroid_longitude'])
        rows.append(dict(
            date=w['date'], tmin_c=w['temperature_min_c'], tmean_c=w['temperature_mean_c'],
            tmax_c=w['temperature_max_c'], precip_mm=w['precipitation_mm'], rh_pct=w['relative_humidity_pct'],
            wind_m_s=w['wind_speed_m_s'], radiation_mj_m2=w['solar_radiation_mj_m2'],
            et0_mm=w['reference_evapotranspiration_mm'],
            source=f"{w['source_version']} regional mean (hackathon dataset)"))
    last = max(r['date'] for r in rows)
    end = min(today, date.today()) - timedelta(days=1)
    if end > last:
        print(f'  {nuts3}: Open-Meteo {last + timedelta(days=1)} → {end}')
        lat, lon = location or centroid
        rows += open_meteo(lat, lon, last + timedelta(days=1), end)
    for r in rows:
        r['nuts3_id'] = nuts3
        for k in ('tmin_c', 'tmean_c', 'tmax_c', 'precip_mm', 'rh_pct', 'wind_m_s', 'radiation_mj_m2', 'et0_mm'):
            r[k] = r2(r[k])
        for base in (0, 5, 6, 10):
            r[f'gdd_base{base}'] = round(max(0.0, r['tmean_c'] - base), 2)
    return rows, centroid


def build_reference(ds, nuts3):
    name, normals, soil = ds.region(nuts3)
    region = dict(
        nuts3_id=nuts3, name=name, country_code=nuts3[:2],
        climate_period=f"{normals.get('context_period_start')}-{normals.get('context_period_end')}",
        mean_annual_precip_mm=r2(normals.get('regional_mean_annual_precipitation_mm')),
        mean_april_sept_precip_mm=r2(normals.get('regional_mean_april_september_precipitation_mm')),
        mean_annual_et0_mm=r2(normals.get('regional_mean_annual_et0_mm')),
        mean_annual_gdd_base5=r2(normals.get('regional_mean_annual_gdd_base_5_c')),
        mean_annual_frost_days=r2(normals.get('regional_mean_annual_frost_days')),
        mean_annual_heat_days=r2(normals.get('regional_mean_annual_heat_days')),
        mean_annual_dry_days=r2(normals.get('regional_mean_annual_dry_days')),
        topsoil_ph=r2(soil.get('topsoil_ph_h2o')),
        topsoil_organic_carbon_g_kg=r2(soil.get('topsoil_organic_carbon_g_kg')),
        topsoil_clay_pct=r2((soil.get('topsoil_clay_g_kg') or 0) / 10),
        topsoil_sand_pct=r2((soil.get('topsoil_sand_g_kg') or 0) / 10),
        topsoil_silt_pct=r2((soil.get('topsoil_silt_g_kg') or 0) / 10),
        source='Hackathon regional layers: AgERA5 climate normals, SoilGrids topsoil')
    crop_ref = [dict(
        crop_code=code, crop_group_code=c['group'], **{f'name_{k}': v for k, v in c['names'].items()},
        ephy_crop_names=c['ephy'], winter_crop=c['winter'], gdd_base_c=c['gdd_base'],
        kc_ini=c['kc'][0], kc_mid=c['kc'][1], kc_end=c['kc'][2],
        typical_sowing=c['sowing'], typical_harvest=c['harvest']) for code, c in ag.CROPS.items()]
    groups = sorted({c['group'] for c in ag.CROPS.values()})
    bench = [dict(
        nuts3_id=nuts3, crop_group_code=b['crop_group_code'], crop_group_name=b['crop_group_name'], year=b['year'],
        yield_t_ha=r2(b['yield_t_ha']), yield_source_geography=b['yield_source_geography'],
        yield_value_type=b['yield_value_type'], n_kg_ha=r2(b['nitrogen_kg_ha']),
        p2o5_kg_ha=r2(b['phosphate_p2o5_kg_ha']), k2o_kg_ha=r2(b['potash_k2o_kg_ha']),
        npk_reference_year=b['npk_reference_year'], irrigated_share=r2(b['irrigated_share']),
        pesticide_total_kg_ai_ha=r2(b['pesticide_total_kg_ai_ha']), herbicide_kg_ai_ha=r2(b['herbicide_kg_ai_ha']),
        fungicide_kg_ai_ha=r2(b['fungicide_kg_ai_ha']), insecticide_kg_ai_ha=r2(b['insecticide_kg_ai_ha']),
        pesticide_reference=b['pesticide_reference_period']) for b in ds.benchmark(nuts3, groups)]
    return region, crop_ref, ag.crop_stage_rows(), bench


# ───────────────────────── E-Phy products ─────────────────────────

class Catalogue:
    """Real products and their authorised uses, from the E-Phy register."""

    def __init__(self, usages, source):
        self.source = source
        self.by_name = defaultdict(list)
        for u in usages:
            if (u.get('type produit') == 'PPP' and (u.get('etat usage') or '').startswith('Autorisé')
                    and u.get('gamme usage') == 'Professionnel'):
                self.by_name[u['nom produit'].strip().upper()].append(u)
        self.products = {}   # AMM number -> product row
        self.uses = []
        self._cache = {}

    @staticmethod
    def _parts(u):
        return (u['identifiant usage'].split('*') + ['', '', ''])[:3]

    def uses_for(self, name, crop, function):
        out = []
        for u in self.by_name.get(name, []):
            crop_name, mode, _ = self._parts(u)
            if (function in u['fonctions'] and crop_name in ag.CROPS[crop]['ephy'] and num(u['dose retenue'])
                    and mode == ('Désherbage' if function == 'Herbicide' else 'Trt Part.Aer.')):
                out.append(u)
        return out

    def candidates(self, crop, ptype):
        key = (crop, ptype)
        if key not in self._cache:
            function = ag.EPHY_FUNCTION[ptype]
            names = ag.PREFERRED_PRODUCTS.get((ag.crop_family(crop), ptype), [])
            found = [(n, self.uses_for(n, crop, function)) for n in names]
            found = [x for x in found if x[1]]
            if not found:  # nothing from our list: take the first products E-Phy allows for this use
                names = sorted(n for n in self.by_name if self.uses_for(n, crop, function))[:3]
                found = [(n, self.uses_for(n, crop, function)) for n in names]
                if found:
                    warnings.append(f'{crop} {ptype}: no preferred product in E-Phy, using {[n for n, _ in found]}')
            for n, _ in found:
                self.add_product(n)
            self._cache[key] = found
        return self._cache[key]

    def choose(self, crop, ptype, targets, key):
        cands = self.candidates(crop, ptype)
        if targets:
            matching = [(n, [u for u in uses if any(t.lower() in u['identifiant usage'].lower() for t in targets)])
                        for n, uses in cands]
            matching = [x for x in matching if x[1]]
            cands = matching or cands
        if not cands:
            return None, None
        name, uses = ag.pick(cands, key, 'product')
        return self.products[uses[0]['numero AMM']], ag.pick(uses, key, 'use')

    def add_product(self, name):
        rows = self.by_name[name]
        amm = rows[0]['numero AMM']
        if amm in self.products:
            return
        functions = rows[0]['fonctions']
        first = functions.split('|')[0].strip()
        kind = {'Herbicide': 'herbicide', 'Fongicide': 'fungicide', 'Insecticide': 'insecticide'}.get(first, first.lower())
        self.products[amm] = dict(
            id=len(self.products) + 1, name=rows[0]['nom produit'].strip(), amm_number=amm, product_kind=kind,
            functions=functions, active_substances=rows[0]['Substances actives'], formulation=rows[0]['formulations'],
            holder=rows[0]['titulaire'], source=f'E-Phy, Anses ({self.source})')
        for crop in ag.CROPS:
            for u in rows:
                crop_name, mode, target = self._parts(u)
                if crop_name not in ag.CROPS[crop]['ephy'] or mode not in ('Désherbage', 'Trt Part.Aer.'):
                    continue
                mx = num(u["nombre max d'application"])
                dar = num(u['delai avant recolte jour'])
                bmin, bmax = num(u['stade cultural min (BBCH)']), num(u['stade cultural max (BBCH)'])
                self.uses.append(dict(
                    id=len(self.uses) + 1, product_id=self.products[amm]['id'], crop_code=crop,
                    usage_id=u['identifiant usage'], target=target or 'Désherbage',
                    max_dose=num(u['dose retenue']), dose_unit=u['dose retenue unite'] or None,
                    max_applications=int(mx) if mx is not None else None,
                    pre_harvest_interval_days=int(dar) if dar is not None else None,
                    bbch_min=int(bmin) if bmin is not None else None, bbch_max=int(bmax) if bmax is not None else None,
                    buffer_zone_water_m=num(u['ZNT aquatique (en m)']),
                    conditions=(u['condition emploi'] or None) and u['condition emploi'][:2000]))

    def add_preferred(self):
        for (family, ptype), names in ag.PREFERRED_PRODUCTS.items():
            crops = ['COWT', 'BARL'] if family == 'CEREAL' else [family]
            for n in names:
                if any(self.uses_for(n, c, ag.EPHY_FUNCTION[ptype]) for c in crops):
                    self.add_product(n)
                else:
                    warnings.append(f'Preferred product {n} has no authorised {ptype.lower()} use on {crops} in E-Phy')


# ───────────────────────── the farm ─────────────────────────

def field_geometry(wkt, origin):
    """Place the dataset's local square (metres) at `origin` (lat, lon). Returns GeoJSON and the centroid."""
    pts = [tuple(map(float, p.split())) for p in re.findall(r'(-?[\d.]+ -?[\d.]+)', wkt)]
    lat0, lon0 = origin
    m_per_deg_lat = 111_320
    m_per_deg_lon = 111_320 * math.cos(math.radians(lat0))
    ring = [[round(lon0 + x / m_per_deg_lon, 6), round(lat0 + y / m_per_deg_lat, 6)] for x, y in pts]
    lons, lats = [p[0] for p in ring[:-1]], [p[1] for p in ring[:-1]]
    return dict(type='Polygon', coordinates=[ring]), sum(lats) / len(lats), sum(lons) / len(lons)


def plan_rotation(parcels, irrigable):
    """Give each field a rotation that ends on the dataset's crop for the last year."""
    plan, seen = {}, Counter()
    for p in parcels:
        crop = p['crop_current']
        if crop == 'MAIZ':
            cycle = ag.ROTATION_IRRIGATED
        elif crop == 'SUNF' and p['parcel_id'] in irrigable:
            cycle = ag.ROTATION_IRRIGATED_SUNF
        else:
            cycle = ag.ROTATION
        if crop not in cycle:
            plan[p['parcel_id']] = ([crop], 0)
            continue
        positions = [i for i, c in enumerate(cycle) if c == crop]
        plan[p['parcel_id']] = (cycle, positions[seen[(tuple(cycle), crop)] % len(positions)])
        seen[(tuple(cycle), crop)] += 1
    return plan


def crop_in(plan, parcel_id, year, last_year):
    cycle, pos = plan[parcel_id]
    return cycle[(pos + year - last_year) % len(cycle)]


class Ids:
    """Row ids shared by all farms, so ids stay unique across the database."""

    def __init__(self):
        self.last = Counter()

    def next(self, table):
        self.last[table] += 1
        return self.last[table]


def farm_profile(code, holding, n_parcels, n_workers):
    """Invented names for a farm; generic ones if the farm has no profile."""
    prof = FARM_PROFILES.get(code)
    if prof is None:
        warnings.append(f'{code}: no profile in FARM_PROFILES, generic names used')
        prof = dict(name=f'Farm {code}', legal_form=None, language='en', timezone='Europe/Brussels',
                    layout_origin=None, earliness={'MAIZ': 'early', 'SUNF': 'early'}, fields=[],
                    members=[dict(rank=i + 1, full_name=f'Worker {i + 1}', main_contact=i == 0) for i in range(n_workers)])
    if len(prof['fields']) < n_parcels:
        warnings.append(f'{code}: {n_parcels} parcels but {len(prof["fields"])} field names, generic names added')
    return prof


def build_farm(ds, code, farm_pk, today, weather_rows, catalogue, main_phone, prices, ids, region_centroid):
    """All rows of one farm. Every farm row gets farm_id = farm_pk."""
    holding = ds.holding(code)
    nuts3 = holding['nuts3']
    country = nuts3[:2]
    parcels = ds.parcels(code)
    labour = sorted(ds.by_holding('labour', code), key=lambda r: r['birth_year'])
    prof = farm_profile(code, holding, len(parcels), len(labour))
    origin = prof['layout_origin'] or region_centroid
    weather = ag.Weather(weather_rows)
    irrigated_years = ds.irrigated_years([p['parcel_id'] for p in parcels])
    # The demo farms are irrigated operations (agronomist call): every field is
    # irrigable and shares the farm's reel gun. `irrigated_years` kept for the record.
    irrigable = {p['parcel_id'] for p in parcels}
    out = defaultdict(list)
    tenant = dict(farm_id=farm_pk)

    # Irrigation equipment and fields
    system_id = None
    if irrigable:
        system_id = ids.next('irrigation_system')
        out['irrigation_system'] = [dict(id=system_id, **tenant, **REEL_GUN)]
    fields = {}
    for i, p in enumerate(parcels):
        shape, lat, lon = field_geometry(p['shape_wkt'], origin)
        is_irrigable = p['parcel_id'] in irrigable
        fields[p['parcel_id']] = dict(
            id=ids.next('field'), **tenant, name=prof['fields'][i] if i < len(prof['fields']) else f'Field {i + 1}',
            area_ha=r2(p['area_ha']), tenure=(p['tenure'] or '').lower() or None, irrigable=is_irrigable,
            irrigation_system_id=system_id if is_irrigable else None,
            centroid_lat=round(lat, 6), centroid_lon=round(lon, 6), shape_geojson=shape, source_parcel_id=p['parcel_id'])
    out['field'] = list(fields.values())
    farm_lat = sum(f['centroid_lat'] for f in out['field']) / len(out['field'])
    farm_lon = sum(f['centroid_lon'] for f in out['field']) / len(out['field'])

    out['farm'] = [dict(
        id=farm_pk, name=prof['name'], legal_form=prof['legal_form'], nuts3_id=nuts3, country_code=country,
        language=prof['language'], timezone=prof['timezone'], lat=round(farm_lat, 6), lon=round(farm_lon, 6),
        uaa_ha=r2(holding['uaa_ha']), organic=bool(holding['organic']), farm_type=f"TF8 class {holding['farm_type_tf8']}",
        source_holding_id=code,
        notes=('Fictional farm for the EU Agri Hackathon demo. Records come from the synthetic holding '
               f'{code}, made realistic by seed.py. Weather, regional statistics and FAO-56 tables are real'
               + ('; products from the French E-Phy register.' if country == 'FR' else
                  '; no national product register loaded, so sprays keep the synthetic substance codes.')))]

    # Members: paired with the dataset workers from oldest to youngest, ids ordered by rank (1 = main contact)
    offset = ids.last['member']
    members, operator = [], {}
    for w, mp in zip(labour, prof['members']):
        mid = offset + mp['rank']
        members.append(dict(
            id=mid, **tenant, full_name=mp['full_name'], role=(w['worker_category'] or 'worker').lower(),
            phone=(main_phone or None) if mp.get('main_contact') else None, language=prof['language'],
            birth_year=w['birth_year'], annual_hours=w['annual_hours'], certiphyto=mp.get('certiphyto', False),
            main_contact=mp.get('main_contact', False), notes=mp.get('notes')))
        for job in mp.get('jobs', []):
            operator[job] = mid
    if len(labour) != len(prof['members']):
        warnings.append(f'{code}: {len(labour)} workers in the dataset, {len(prof["members"])} member profiles')
    members.sort(key=lambda m: m['id'])
    ids.last['member'] = max([offset] + [m['id'] for m in members])
    main_id = next((m['id'] for m in members if m['main_contact']), members[0]['id'] if members else None)
    operator = {job: operator.get(job, main_id) for job in ('sowing', 'fertilisation', 'spraying', 'irrigation')}
    out['member'] = members

    # Soil
    for i, s in enumerate(ds.soil([p['parcel_id'] for p in parcels])):
        row = {k: r2(v) for k, v in s.items() if k != 'parcel_id'}
        out['soil_analysis'].append(dict(id=ids.next('soil_analysis'), **tenant, field_id=fields[s['parcel_id']]['id'],
                                         sampled_on=date(2024, 9, 10) + timedelta(days=i), origin='dataset', **row))

    # Which synthetic records feed each crop season
    plan = plan_rotation(parcels, irrigable)
    years = sorted({y for (_, y) in ds.season_records([parcels[0]['parcel_id']])})
    first_year, last_year = years[0], years[-1]
    donors = ds.donor_parcels(nuts3, holding['farm_type_tf8'], code)
    jobs = []
    for p in parcels:
        for y in range(first_year, last_year + 2):
            crop = crop_in(plan, p['parcel_id'], y, last_year)
            data_year, shift = (y, 0) if y <= last_year else (last_year, y - last_year)
            src = p['parcel_id'] if p['crop_current'] == crop else ag.pick(donors[crop], p['parcel_id'], y, 'donor')
            jobs.append((p, y, crop, src, data_year, shift))
    records = ds.season_records(sorted({j[3] for j in jobs}))

    seasons = []
    prev_harvest = {}

    def add_op(**kw):
        oid = ids.next('operation')
        out['operation'].append(dict(id=oid, **tenant, **kw))
        stats[f"op {kw['op_type']} {kw['status']}"] += 1
        return oid

    for p, y, crop, src, data_year, shift in jobs:
        pid, field = p['parcel_id'], fields[p['parcel_id']]
        rec = records.get((src, data_year), {})
        if not rec.get('planting') or not rec.get('harvest'):
            warnings.append(f'{field["name"]} {y}: no planting or harvest record in source {src}, season skipped')
            continue
        pl, hv = rec['planting'][0], rec['harvest'][0]
        sow = ag.shift_year(pl['plant_date'], shift)
        harvest = ag.shift_year(hv['harvest_date'], shift)
        if crop == 'RAPE':  # dataset sows rapeseed in Oct-Nov; it is sown late Aug - early Sep
            sow = date(y - 1, 8, 22) + timedelta(days=int(ag.h(pid, y, 'sow') * 19))
        if crop == 'BARL' and sow > date(y - 1, 10, 31):
            sow = date(y - 1, 10, 5) + timedelta(days=int(ag.h(pid, y, 'sow') * 21))
        if pid in prev_harvest and sow <= prev_harvest[pid] + timedelta(days=10):
            sow = prev_harvest[pid] + timedelta(days=10 + int(ag.h(pid, y, 'gap') * 10))
        prev_harvest[pid] = harvest
        season = ag.Season(crop, sow, harvest, weather)
        status = 'planned' if sow > today else 'growing' if harvest > today else 'harvested'
        irr = (rec.get('irrigation') or [{}])[0]
        water = (float(irr.get('water_mm') or 0)
                 if field['irrigable'] and crop in ag.IRRIGATED_CROPS and irr.get('irrigated') else 0)
        cs_id = ids.next('crop_season')
        borrowed = src != pid
        seasons.append(dict(
            id=cs_id, **tenant, field_id=field['id'], harvest_year=y, crop_code=crop, variety=pl['variety'],
            earliness_group=prof['earliness'].get(crop),
            previous_crop_code=crop_in(plan, pid, y - 1, last_year), sowing_date=sow, harvest_date=harvest,
            status=status, irrigated=water > 0,
            yield_t_ha=r2(hv['yield_t_ha']) if status == 'harvested' else None,
            moisture_pct=r2(hv['moisture_pct']) if status == 'harvested' else None,
            protein_pct=r2(hv['protein_pct']) if status == 'harvested' else None,
            origin='generated' if shift else 'dataset_adjusted',
            details=dict(source_parcel=src, source_year=data_year,
                         note=('Crop rotation added by the seed: records taken from a parcel of another synthetic '
                               'farm in the same region.' if borrowed else 'Records of this parcel.')
                         + (f' Shifted {shift} year(s) to plan the next season.' if shift else ''))))
        base = dict(field_id=field['id'], crop_season_id=cs_id, area_ha=field['area_ha'], source='import',
                    origin='generated' if shift else 'dataset_adjusted')

        def state(d):
            return 'confirmed' if d <= today else 'planned'

        add_op(**base, op_date=sow, op_type='sowing', status=state(sow), member_id=operator['sowing'], bbch=0,
               variety=pl['variety'], seed_rate_kg_ha=r2(pl['seed_rate_kg_ha']), seed_origin=pl['seed_origin'],
               details=dict(source_table='synthetic_planting', source_id=pl['planting_id'], source_parcel=src,
                            source_date=str(pl['plant_date'])))

        # Fertiliser: organic before sowing, mineral nitrogen at the usual stages.
        mineral_i, organic_done = 0, False
        for f in sorted(rec.get('fertilisation', []), key=lambda r: r['app_date']):
            key = (pid, y, f['fertilisation_id'])
            if f['product_type'] == 'ORGANIC' and not organic_done:  # one manure spread before sowing
                d, bbch = sow - timedelta(days=10 + int(ag.h(key) * 20)), None
                organic_done = True
            else:
                windows = ag.FERT_WINDOWS[crop]
                lo, hi, not_before = windows[min(mineral_i, len(windows) - 1)]
                mineral_i += 1
                d = ag.date_in_window(season, lo, hi, not_before, y, key)
                d = min(d, harvest - timedelta(days=30))
                bbch = season.bbch(d)
            if d > today:
                stats['fertilisation dropped (future)'] += 1
                continue
            method = f['method']
            if method == 'FERTIGATION' and not water:
                method = 'BROADCAST'
            add_op(**base, op_date=d, op_type='fertilisation', status='confirmed', member_id=operator['fertilisation'],
                   bbch=bbch, fertiliser_type=f['product_type'].lower(), n_kg_ha=r2(f['n_kg_ha']),
                   p2o5_kg_ha=r2(f['p2o5_kg_ha']), k2o_kg_ha=r2(f['k2o_kg_ha']), method=method.lower(),
                   details=dict(source_table='synthetic_fertilisation', source_id=f['fertilisation_id'],
                                source_parcel=src, source_date=str(f['app_date'])))

        # Sprays: same number and types as the dataset, moved to the right stage. Real products in France only.
        by_type = defaultdict(list)
        for s in sorted(rec.get('plant_protection', []), key=lambda r: r['app_date']):
            by_type[s['product_type']].append(s)
        for ptype, sprays in by_type.items():
            windows = ag.SPRAY_WINDOWS.get((ag.crop_family(crop), ptype))
            if not windows:
                stats[f'spray dropped (no window for {ptype})'] += 1
                continue
            start = int(ag.h(pid, y, ptype, 'window') * len(windows))
            for k, s in enumerate(sprays):
                key = (pid, y, s['pp_id'])
                lo, hi, not_before, targets, label = windows[(start + k) % len(windows)]
                d = ag.date_in_window(season, lo, hi, not_before, y, key)
                if ag.CROPS[crop]['winter']:
                    d = ag.avoid_winter(d, sow, y, autumn=lo < 20, key=key)
                d = ag.calm_day(d, weather, sow, harvest - timedelta(days=14))
                if d > today:
                    stats['spray dropped (future)'] += 1
                    continue
                if country == 'FR':
                    product, use = catalogue.choose(crop, ptype, targets, key)
                    if product is None:
                        stats[f'spray dropped (no product for {crop} {ptype})'] += 1
                        continue
                    target = (use['identifiant usage'].split('*') + ['', '', ''])[2] or 'Désherbage'
                    spray_input = dict(product_id=product['id'], product_name=product['name'],
                                       dose=round(num(use['dose retenue']) * ag.pick(DOSE_FACTORS, key, 'dose'), 2),
                                       dose_unit=use['dose retenue unite'], target=target)
                else:  # no national register loaded: keep the dataset substance code, say it is synthetic
                    spray_input = dict(product_id=None,
                                       product_name=f"{ptype.title()} {s['active_substance']} (synthetic)",
                                       dose=r2(s['dose_l_or_kg_ha']), dose_unit='L or kg/ha', target=label)
                oid = add_op(**base, op_date=d, op_type='spraying', status='confirmed', member_id=operator['spraying'],
                             bbch=season.bbch(d), notes=label,
                             details=dict(source_table='synthetic_plant_protection', source_id=s['pp_id'],
                                          source_parcel=src, source_date=str(s['app_date']),
                                          source_product=s['product_name'], source_substance=s['active_substance'],
                                          source_dose=s['dose_l_or_kg_ha'], source_bbch=s['crop_stage_bbch']))
                out['operation_input'].append(dict(id=ids.next('operation_input'), **tenant, operation_id=oid,
                                                   **spray_input))

        # Irrigation: split the yearly total into watering turns.
        if water:
            for d, mm in ag.irrigation_events(season, weather, water, (pid, y)):
                if d > today:
                    stats['irrigation dropped (future)'] += 1
                    continue
                add_op(**base, op_date=d, op_type='irrigation', status='confirmed', member_id=operator['irrigation'],
                       bbch=season.bbch(d), water_mm=mm, method='sprinkler',
                       details=dict(source_table='synthetic_irrigation', source_id=irr.get('irrigation_id'),
                                    source_parcel=src, yearly_total_mm=water,
                                    note='Yearly total split into turns by the seed (water balance with real ET0 and rain).'))

        if status != 'planned':
            done = harvest <= today
            add_op(**base, op_date=harvest, op_type='harvest', status=state(harvest), bbch=89,
                   yield_t_ha=r2(hv['yield_t_ha']) if done else None,
                   moisture_pct=r2(hv['moisture_pct']) if done else None,
                   protein_pct=r2(hv['protein_pct']) if done else None, notes='Combine: contractor',
                   details=dict(source_table='synthetic_harvest', source_id=hv['harvest_id'], source_parcel=src,
                                source_date=str(hv['harvest_date'])))

    out['crop_season'] = seasons

    # Business data
    out['subsidy'] = [dict(id=ids.next('subsidy'), **tenant, year=s['year'], scheme=s['scheme'],
                           amount_eur=r2(s['amount_eur']), origin='dataset')
                      for s in ds.by_holding('subsidy', code, 'year, scheme')]
    econ_cols = ['total_output_eur', 'seeds_eur', 'fertiliser_eur', 'crop_protection_eur', 'energy_eur',
                 'contract_work_eur', 'wages_eur', 'depreciation_eur', 'total_inputs_eur', 'farm_net_value_added_eur']
    out['farm_economics'] = [dict(**tenant, year=e['year'], origin='dataset', **{c: r2(e[c]) for c in econ_cols})
                             for e in ds.by_holding('farm_economics', code, 'year')]
    buyers = sorted({s['buyer_id'] for s in ds.by_holding('transaction_sale', code)}) or ['BUYER-001']
    out['sale'] = [dict(id=ids.next('sale'), **tenant, **row)
                   for row in build_sales(seasons, fields, prices, buyers, today)]
    return out


def build_sales(seasons, fields, prices, buyers, today):
    """Sell each harvest in 3 lots (cooperative, forward, spot) at the monthly price. Unsold lots stay in stock."""
    area = {f['id']: float(f['area_ha']) for f in fields.values()}
    price = {(p['product'], p['year'], p['month']): float(p['price_eur_t']) for p in prices}
    prod, end = defaultdict(float), {}
    for s in seasons:
        if s['status'] == 'harvested' and s['yield_t_ha']:
            k = (s['harvest_year'], s['crop_code'])
            prod[k] += area[s['field_id']] * float(s['yield_t_ha'])
            end[k] = max(end.get(k, s['harvest_date']), s['harvest_date'])
    rows = []
    for (y, crop), tonnes in sorted(prod.items()):
        lots = [(0.5, end[(y, crop)] + timedelta(days=5 + int(ag.h(y, crop, 1) * 15)), 'COOPERATIVE'),
                (0.3, date(y, 12, 1) + timedelta(days=int(ag.h(y, crop, 2) * 40)), 'FORWARD'),
                (0.2, date(y + 1, 3, 1) + timedelta(days=int(ag.h(y, crop, 3) * 60)), 'SPOT')]
        for share, d, contract in lots:
            p = price.get((crop, d.year, d.month))
            if d > today or p is None:
                continue
            grade = ag.pick(['A', 'B', 'B', 'C'], y, crop, contract)
            rows.append(dict(sale_date=d, crop_code=crop, harvest_year=y,
                             volume_t=round(tonnes * share, 1),
                             price_eur_t=round(p * {'A': 1.02, 'B': 1.0, 'C': 0.96}[grade], 2),
                             buyer=ag.pick(buyers, y, crop, contract), contract_type=contract,
                             quality_grade=grade, origin='generated'))
    return rows


# ───────────────────────── FAO-56 reference tables ─────────────────────────

def fao_columns():
    """Column names and SQL types per FAO table, read from schema_fao.sql (one source of truth)."""
    out, table = {}, None
    for line in SCHEMA_FAO.read_text().splitlines():
        m = re.match(r'create table (\w+) \(', line)
        if m:
            table = m.group(1)
            out[table] = {}
        elif table and line.startswith(')'):
            table = None
        elif table and (m := re.match(r'\s+(\w+) (\w+)', line)):
            out[table][m.group(1)] = m.group(2)
    return out


def build_fao(fao_dir):
    """Read Marceau's CSV files. Stops if a column of schema_fao.sql is missing from a file."""
    columns = fao_columns()
    out = {}
    for table, fname in FAO_FILES.items():
        with open(Path(fao_dir) / fname, encoding='utf-8-sig', newline='') as f:
            reader = csv.DictReader(f)
            wanted = [c for c, t in columns[table].items() if t != 'serial' and c not in FAO_DERIVED]
            missing = sorted(set(wanted) - set(reader.fieldnames))
            if missing:
                raise SystemExit(f'{fname}: missing columns {missing}. Update schema_fao.sql or the file.')
            extra = sorted(set(reader.fieldnames) - set(wanted))
            if extra:
                warnings.append(f'{fname}: columns not loaded {extra}')
            rows = []
            for r in reader:
                row = {}
                for c in wanted:
                    v = (r[c] or '').strip()
                    kind = columns[table][c]
                    if v == '':
                        row[c] = None
                    elif kind in ('int', 'numeric'):
                        if num(v) is None:
                            raise SystemExit(f'{fname}: column {c} should be a number, got {v!r}')
                        row[c] = int(num(v)) if kind == 'int' else num(v)
                    else:
                        row[c] = v
                if table == 'stage_thresholds_gdd':
                    row['gdd_from_sowing_default_num'] = num(row['gdd_from_sowing_default'])
                    row['earliness_group'] = next((g for prefix, g in EARLINESS_ANCHORS.get(row['crop_code'], [])
                                                   if row['anchor_stage'].startswith(prefix)), None)
                rows.append(row)
        out[table] = rows
    found = Counter(r['earliness_group'] for r in out['stage_thresholds_gdd'] if r['earliness_group'])
    expected = [g for anchors in EARLINESS_ANCHORS.values() for _, g in anchors]
    if sum(found.values()) != len(expected):
        warnings.append(f'stage_thresholds_gdd: expected {len(expected)} rows with a variety group, found {dict(found)}. '
                        'Check the anchor_stage texts.')
    return out


def reference_weather(ds):
    """(Tmin, Tmax) per day in the reference region, for the years of the reference seasons."""
    seasons = REFERENCE_SEASONS.values()
    years = range(min(s.year for s, _ in seasons), max(h.year for _, h in seasons) + 1)
    return {w['date']: (w['temperature_min_c'], w['temperature_max_c'])
            for w in ds.weather_years(REFERENCE_NUTS3, years)}


def daily_gdd(tmin, tmax, base, cap):
    """Degree-days of one day. Same rule as the API engine (cropModel.ts dailyGdd)."""
    if cap is not None:
        tmax = min(tmax, cap)
    return max(0.0, (tmax + tmin) / 2 - base)


def reference_ends(stage, weather):
    """Degree-days from sowing at the end of ini, dev, mid and late, in the reference season of the crop.

    The FAO day lengths are stretched to the real season (k = season days / FAO days); each end date then
    gets the degree-days summed from sowing to that date, both days included (like the engine).
    """
    sow, harvest = REFERENCE_SEASONS[stage['crop_code']]
    lengths = [stage['l_ini_days'], stage['l_dev_days'], stage['l_mid_days'], stage['l_late_days']]
    k = (harvest - sow).days / sum(lengths)
    ends, total, day, gdd = [], 0, sow, 0.0
    for n in lengths:
        total += n
        end = sow + timedelta(days=round(k * total))
        while day <= end:
            if day not in weather:
                raise SystemExit(f'No {REFERENCE_NUTS3} weather on {day} for the {stage["crop_code"]} reference season.')
            gdd += daily_gdd(*weather[day], stage['t_base_c'], stage['t_max_cap_c'])
            day += timedelta(days=1)
        ends.append(gdd)
    return ends


def anchor(anchors, crop, text):
    """Default degree-days of the one anchor of `crop` whose anchor_stage contains `text`."""
    found = [r for r in anchors if r['crop_code'] == crop and text in r['anchor_stage']]
    if len(found) != 1 or found[0]['gdd_from_sowing_default_num'] is None:
        raise SystemExit(f'stage_thresholds_gdd: expected one {crop} anchor "{text}" with a number, found {len(found)}.')
    return found[0]['gdd_from_sowing_default_num']


def after_flowering(anchors, crop, boundary):
    """N of the `crop` anchor written "flowering + N" that ends the FAO phase `boundary` (e.g. "end of mid")."""
    for r in anchors:
        m = re.fullmatch(r'flowering \+ (\d+)', r['gdd_from_sowing_default'] or '')
        if r['crop_code'] == crop and r['fao56_phase_boundary'] == boundary and m:
            return float(m.group(1))
    raise SystemExit(f'stage_thresholds_gdd: no {crop} anchor "flowering + N" for {boundary}.')


def group_ranges(anchors, crop, boundary):
    """Published (min, max) per variety group of the `crop` anchor that ends `boundary`.

    The ranges are only in the source text ("1340-1410 / 1390-1460 / ..."), one per group, in the order
    of EARLINESS_ANCHORS (earliest first).
    """
    groups = [g for _, g in EARLINESS_ANCHORS[crop]]
    for r in anchors:
        if r['crop_code'] == crop and r['fao56_phase_boundary'] == boundary:
            ranges = [(float(lo), float(hi)) for lo, hi in re.findall(r'(\d+)-(\d+)', r['source'] or '')]
            if len(ranges) != len(groups) or any(lo > hi for lo, hi in ranges):
                raise SystemExit(f'stage_thresholds_gdd: {crop} {boundary}: expected {len(groups)} ranges '
                                 f'"min-max" in the source, found {ranges}.')
            return dict(zip(groups, ranges))
    raise SystemExit(f'stage_thresholds_gdd: no {crop} anchor for {boundary}.')


def build_crop_phase_gdd(fao, weather):
    """Rows of crop_phase_gdd: degree-days from sowing at the end of each FAO-56 phase, per crop and variety group.

    Published anchors first; FAO day lengths on the Loiret reference season elsewhere (method says which).
    The mid / late split, when not published, follows the FAO day lengths. Values in whole degree-days.
    """
    anchors = fao['stage_thresholds_gdd']
    stages = {r['crop_code']: r for r in fao['fao56_crop_stages']}
    before, after, p_flower = FLOWERING_WINDOW
    rows = []

    def add(crop, group, ends, flowering, sensitive, method):
        ends = [round(v) for v in ends]
        if not ends[0] < ends[1] < ends[2] < ends[3]:
            raise SystemExit(f'crop_phase_gdd {crop} {group}: phase ends do not increase {ends}.')
        rows.append(dict(crop_code=crop, earliness_group=group, ini_end=ends[0], dev_end=ends[1], mid_end=ends[2],
                         late_end=ends[3], flowering=round(flowering), sensitive_from=round(sensitive[0]),
                         sensitive_to=round(sensitive[1]), sensitive_p=sensitive[2], method=method))
        return rows[-1]

    def default_row(crop, group):
        """The row with no variety group = the row of `group`."""
        row = next(r for r in rows if r['crop_code'] == crop and r['earliness_group'] == group)
        rows.append(dict(row, earliness_group=None, method=f'Default = {group} group. {row["method"]}'))

    def mid_end(crop, dev, late):
        """Split dev end .. late end like the FAO mid and late day lengths."""
        st = stages[crop]
        return dev + (late - dev) * st['l_mid_days'] / (st['l_mid_days'] + st['l_late_days'])

    def fao_days(crop):
        st = stages[crop]
        return f'FAO days {st["l_mid_days"]}/{st["l_late_days"]}'

    def derived(crop):
        sow, harvest = REFERENCE_SEASONS[crop]
        years = f'{sow.year}' if sow.year == harvest.year else f'{sow.year}-{harvest.year % 100:02d}'
        return f'derived (FAO days on Loiret {years})'

    # Maize: flowering per variety group is published. The full-cover anchor (760) is given for the early group:
    # every group keeps the same gap to flowering. Mid and late ends: the default is published relative to
    # flowering (+ 590, + 780), and a range is published per group. Later groups need more degree-days after
    # flowering, so the default is kept only inside the range of the group; else the middle of the range.
    flowering = {r['earliness_group']: r['gdd_from_sowing_default_num']
                 for r in anchors if r['crop_code'] == 'MAIZ' and r['earliness_group']}
    ini = anchor(anchors, 'MAIZ', '= end of ini')
    dev_gap = flowering['early'] - anchor(anchors, 'MAIZ', '= end of dev')
    mid_gap, late_gap = after_flowering(anchors, 'MAIZ', 'end of mid'), after_flowering(anchors, 'MAIZ', 'end of late')
    mid_ranges, late_ranges = group_ranges(anchors, 'MAIZ', 'end of mid'), group_ranges(anchors, 'MAIZ', 'end of late')

    def maize_end(name, f, gap, rng):
        """(value, method text) of a maize phase end: flowering + gap inside the group range, else its middle."""
        lo, hi = rng
        if lo <= f + gap <= hi:
            return f + gap, f'{name} end flowering + {gap:g} published (in the group range {lo:g}-{hi:g})'
        middle = round((lo + hi) / 2)
        return middle, f'{name} end {middle:g} = middle of the published group range {lo:g}-{hi:g}'

    for group, f in flowering.items():
        mid, mid_text = maize_end('mid', f, mid_gap, mid_ranges[group])
        late, late_text = maize_end('late', f, late_gap, late_ranges[group])
        add('MAIZ', group, [ini, f - dev_gap, mid, late], f, (f - before, f + after, p_flower),
            f'Flowering published (Isagri, Arvalis); ini end {ini:g} derived (5-6 leaves); dev end flowering - '
            f'{dev_gap:g} derived; {mid_text}; {late_text}.')
    default_row('MAIZ', 'early')

    # Sunflower: full cycle per variety group is published; flowering to harvest is a published span.
    # The star-bud anchor (720) is given for the early group: every group keeps the same gap to flowering.
    cycle = {r['earliness_group']: r['gdd_from_sowing_default_num']
             for r in anchors if r['crop_code'] == 'SUNF' and r['earliness_group']}
    to_harvest = anchor(anchors, 'SUNF', 'Flowering (F1) to whole-plant harvest')
    bud_gap = cycle['early'] - to_harvest - anchor(anchors, 'SUNF', 'Star bud')
    ini = reference_ends(stages['SUNF'], weather)[0]
    for group, c in cycle.items():
        f = c - to_harvest
        add('SUNF', group, [ini, f - bud_gap, mid_end('SUNF', f - bud_gap, c), c], f, (f - before, f + after, p_flower),
            f'Late end = full cycle published (Terres Inovia); flowering = cycle - {to_harvest:g} (published span); '
            f'dev end flowering - {bud_gap:g} derived; mid end split by {fao_days("SUNF")}; '
            f'ini end {derived("SUNF")}.')
    default_row('SUNF', 'early')

    # Winter wheat: published stage sums (Isagri) except harvest maturity (derived in the file).
    dev, late = anchor(anchors, 'COWT', 'Booting complete'), anchor(anchors, 'COWT', 'Harvest maturity')
    heading, f = anchor(anchors, 'COWT', 'Start of heading'), anchor(anchors, 'COWT', 'Start of flowering')
    wheat = add('COWT', None, [reference_ends(stages['COWT'], weather)[0], dev, mid_end('COWT', dev, late), late], f,
                (heading, WHEAT_END_OF_FLOWERING, WHEAT_P_SENSITIVE),
                f'Dev end (booting), flowering, sensitive heading to end of flowering published (Isagri); late end '
                f'{late:g} derived; mid end split by {fao_days("COWT")}; ini end {derived("COWT")}.')

    # Winter barley: no published sums. Proxy = the wheat row minus about 10 %.
    add('BARL', None, [wheat[k] * BARLEY_FACTOR for k in ('ini_end', 'dev_end', 'mid_end', 'late_end')],
        wheat['flowering'] * BARLEY_FACTOR,
        (wheat['sensitive_from'] * BARLEY_FACTOR, wheat['sensitive_to'] * BARLEY_FACTOR, wheat['sensitive_p']),
        f'Proxy: winter wheat row x {BARLEY_FACTOR:g} (no published barley sums).')

    # Winter rapeseed: no stage sums published. All ends from the reference season; flowering at the end of dev.
    ends = reference_ends(stages['RAPE'], weather)
    add('RAPE', None, ends, ends[1], (ends[1], ends[1] + RAPE_WINDOW[0], RAPE_WINDOW[1]),
        f'All ends {derived("RAPE")}; flowering = dev end; sensitive flowering to + '
        f'{RAPE_WINDOW[0]}, p {RAPE_WINDOW[1]:.2f}.')
    return rows


# ───────────────────────── database ─────────────────────────

def normalise(rows):
    cols = []
    for r in rows:
        for k in r:
            if k not in cols:
                cols.append(k)
    return cols


def write(db_url, tables, reset, yes, only_fao=False):
    import psycopg
    from psycopg.types.json import Jsonb

    with psycopg.connect(db_url, prepare_threshold=None, connect_timeout=20) as conn:
        print(f'\nDatabase: {conn.info.host}:{conn.info.port}/{conn.info.dbname} as {conn.info.user}')
        target = FAO_TABLES if only_fao else TABLES + FAO_TABLES
        existing = [t for t in target if conn.execute('select to_regclass(%s)', [f'public.{t}']).fetchone()[0]]
        if existing and not reset:
            raise SystemExit(f'These tables already exist: {", ".join(existing)}.\n'
                             'Run with --reset to drop and rebuild them.')
        action = 'DROP and rebuild' if existing else 'create'
        if not yes:
            if not sys.stdin.isatty():
                raise SystemExit('Add --yes to confirm when not running in a terminal.')
            if input(f'This will {action} {len(target)} tables. Type yes to go on: ').strip() != 'yes':
                raise SystemExit('Stopped. Nothing was changed.')
        with conn.transaction():
            if existing:
                if not only_fao:
                    conn.execute(f'drop view if exists {", ".join(VIEWS)} cascade')
                conn.execute(f'drop table if exists {", ".join(target)} cascade')
            if not only_fao:
                conn.execute(SCHEMA.read_text())
            conn.execute(SCHEMA_FAO.read_text())
            for t in target:
                rows = tables.get(t) or []
                if not rows:
                    continue
                cols = normalise(rows)
                sql = f'insert into {t} ({", ".join(cols)}) values ({", ".join(["%s"] * len(cols))})'
                values = [[Jsonb(r.get(c)) if isinstance(r.get(c), dict) else r.get(c) for c in cols] for r in rows]
                with conn.cursor() as cur:
                    cur.executemany(sql, values)
                print(f'  {t:<20} {len(rows):>6} rows')
            for t in [] if only_fao else SERIAL_TABLES:
                conn.execute(f"select setval(pg_get_serial_sequence('{t}', 'id'), "
                             f"coalesce((select max(id) from {t}), 0) + 1, false)")
    print('Done. The transaction is committed.')


# ───────────────────────── main ─────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dry-run', action='store_true', help='build the data and print a summary, write nothing')
    ap.add_argument('--reset', action='store_true', help='drop the farm tables if they exist, then rebuild')
    ap.add_argument('--yes', action='store_true', help='do not ask for confirmation')
    ap.add_argument('--only-fao', action='store_true', help='load only the FAO-56 reference tables')
    args = ap.parse_args()

    load_dotenv(ROOT / '.env')
    fao_dir = Path(os.environ.get('FAO_DIR') or ROOT / 'fao56')
    db_url = os.environ.get('DATABASE_URL')
    if not args.dry_run and not db_url:
        raise SystemExit('Set DATABASE_URL in .env, or use --dry-run.')

    datasets_dir = os.environ.get('DATASETS_DIR')
    if not datasets_dir:
        raise SystemExit('Set DATASETS_DIR in .env (the folder dg-agri-hackathon-datasets).')

    if args.only_fao:
        print(f'Reading FAO-56 tables from {fao_dir}, {REFERENCE_NUTS3} reference weather from {datasets_dir}')
        tables = build_fao(fao_dir)
        tables['crop_phase_gdd'] = build_crop_phase_gdd(tables, reference_weather(Datasets(datasets_dir)))
        for t in FAO_TABLES:
            print(f'  {t:<22} {len(tables[t]):>4}')
        for w in warnings:
            print(f'  ! {w}')
        if args.dry_run:
            print('\nDry run: nothing written.')
            return tables
        write(db_url, tables, args.reset, args.yes, only_fao=True)
        return tables

    farm_codes = [c.strip() for c in (os.environ.get('FARM_IDS') or ','.join(DEFAULT_FARMS)).split(',') if c.strip()]
    today = date.fromisoformat(os.environ['DEMO_TODAY']) if os.environ.get('DEMO_TODAY') else date.today()
    phones = [p.strip() for p in os.environ.get('MEMBER_PHONES', '').split(',')]

    print(f'Farms {", ".join(farm_codes)}, demo date {today}')
    ds = Datasets(datasets_dir)
    holdings = {c: ds.holding(c) for c in farm_codes}

    catalogue = None
    if any(h['nuts3'].startswith('FR') for h in holdings.values()):
        print('Reading E-Phy (French product register)...')
        usages, ephy_file = ephy_usages(ROOT / '.cache')
        catalogue = Catalogue(usages, ephy_file)
        catalogue.add_preferred()

    print('Reading reference data and weather...')
    tables = defaultdict(list)
    weather, centroids = {}, {}
    for code, h in holdings.items():
        nuts3 = h['nuts3']
        if nuts3 in weather:
            continue
        region, crop_ref, crop_stage, bench = build_reference(ds, nuts3)
        origin = (FARM_PROFILES.get(code) or {}).get('layout_origin')
        location = (origin[0] + 0.02, origin[1] + 0.03) if origin else None   # about the middle of the fields
        weather[nuts3], centroids[nuts3] = build_weather(ds, nuts3, location, today)
        region['centroid_lat'], region['centroid_lon'] = centroids[nuts3]
        tables['region'].append(region)
        tables['regional_benchmark'] += bench
        tables['weather_daily'] += weather[nuts3]
        tables['crop_ref'], tables['crop_stage'] = crop_ref, crop_stage
    prices = ds.market_prices(list(ag.CROPS))
    tables['market_price'] = [dict(crop_code=m['product'], year=m['year'], month=m['month'],
                                   price_eur_t=r2(m['price_eur_t'])) for m in prices]

    ids = Ids()
    for i, (code, h) in enumerate(holdings.items()):
        print(f'Building {code} ({h["nuts3"]})...')
        farm_pk = ids.next('farm')
        rows = build_farm(ds, code, farm_pk, today, weather[h['nuts3']], catalogue,
                          phones[i] if i < len(phones) else None, prices, ids, centroids[h['nuts3']])
        for t, r in rows.items():
            tables[t] += r
    if catalogue:
        tables['product'], tables['product_use'] = list(catalogue.products.values()), catalogue.uses
    if fao_dir.exists():
        tables.update(build_fao(fao_dir))
        tables['crop_phase_gdd'] = build_crop_phase_gdd(tables, reference_weather(ds))
    else:
        warnings.append(f'FAO_DIR {fao_dir} not found: FAO-56 tables stay empty')

    print('\nRows to load:')
    for t in TABLES + FAO_TABLES:
        print(f'  {t:<22} {len(tables.get(t) or []):>6}')
    print('\nOperations:')
    for k, v in sorted(stats.items()):
        print(f'  {k:<40} {v:>6}')
    for w in warnings:
        print(f'  ! {w}')

    if args.dry_run:
        print('\nDry run: nothing written.')
        return tables
    write(db_url, tables, args.reset, args.yes)
    return tables


if __name__ == '__main__':
    main()
