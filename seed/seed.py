#!/usr/bin/env python3
"""Load one demo farm into the farm database (Supabase / PostgreSQL).

    python seed.py --dry-run   build everything and print a summary, write nothing
    python seed.py             create the tables and load the data (empty database)
    python seed.py --reset     drop the farm tables first, then rebuild them
    python seed.py --only-fao  load only the FAO-56 reference tables (add --reset to reload)

Settings come from seed/.env (see .env.example and README.md).

What it does:
  1. Reads the demo farm from the hackathon synthetic tables.
  2. Fixes what is not realistic: adds a crop rotation, moves sprays and
     fertiliser to the right crop stages using real weather, removes sprays
     after harvest, splits yearly irrigation into watering turns.
  3. Replaces the fake product names with real products from E-Phy.
  4. Adds real weather (AgERA5 to 2024, then Open-Meteo), regional benchmarks,
     and the FAO-56 reference tables from FAO_DIR (Marceau's files).
  5. Writes everything in one transaction: if something fails, nothing changes.
"""

import argparse
import csv
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
# Variety earliness group per crop for the demo (the dataset variety codes carry none).
EARLINESS = {'MAIZ': 'early', 'SUNF': 'early'}
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
SERIAL_TABLES = ['product', 'product_use', 'member', 'irrigation_system', 'field', 'soil_analysis', 'crop_season', 'message',
                 'operation', 'operation_input', 'alert', 'document', 'sale', 'subsidy']

# ── Invented details (the demo farm is fictional) ──
FARM_NAME = 'GAEC des Trois Chênes'
FARM_LEGAL_FORM = 'GAEC'
# One reel gun shared by the irrigable fields (typical French values, invented for the demo).
REEL_GUN = dict(id=1, name='Reel gun 1', system_type='reel_gun', efficiency=0.75, dose_min_mm=20, dose_max_mm=40,
                round_days=3, notes='Hose reel with a water gun, shared by the irrigable fields.', origin='invented')
LAYOUT_ORIGIN = (48.020, 1.760)  # south-west corner of the field layout, in the Beauce part of Loiret
FIELD_NAMES = ['Le Moulin', 'La Grande Pièce', 'Les Longues Raies', 'Le Bois Carré', 'La Mare',
               'Le Petit Clos', 'Les Sablons', 'La Croix Blanche', 'Le Chemin Vert', 'La Vallée', 'Le Puits']
# Paired with the dataset's workers from oldest to youngest. id 1 is the main contact.
MEMBER_PROFILES = [
    dict(id=3, full_name='Monique Lefèvre', certiphyto=False, notes='Accounts and CAP declarations.'),
    dict(id=2, full_name='Sophie Lefèvre', certiphyto=True, notes='Does the spraying.'),
    dict(id=1, full_name='Claire Lefèvre', certiphyto=True, main_contact=True,
         notes='Runs the farm. Main contact. Does sowing and fertiliser.'),
    dict(id=4, full_name='Camille Lefèvre', certiphyto=True, notes='Irrigation and crop scouting.'),
]
OPERATOR = {'sowing': 1, 'fertilisation': 1, 'spraying': 2, 'irrigation': 4}
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

def build_weather(ds, nuts3, lat, lon, today):
    rows = []
    for w in ds.weather(nuts3):
        rows.append(dict(
            date=w['date'], tmin_c=w['temperature_min_c'], tmean_c=w['temperature_mean_c'],
            tmax_c=w['temperature_max_c'], precip_mm=w['precipitation_mm'], rh_pct=w['relative_humidity_pct'],
            wind_m_s=w['wind_speed_m_s'], radiation_mj_m2=w['solar_radiation_mj_m2'],
            et0_mm=w['reference_evapotranspiration_mm'],
            source=f"{w['source_version']} regional mean (hackathon dataset)"))
    last = max(r['date'] for r in rows)
    end = min(today, date.today()) - timedelta(days=1)
    if end > last:
        print(f'  Open-Meteo {last + timedelta(days=1)} → {end}')
        rows += open_meteo(lat, lon, last + timedelta(days=1), end)
    for r in rows:
        for k in ('tmin_c', 'tmean_c', 'tmax_c', 'precip_mm', 'rh_pct', 'wind_m_s', 'radiation_mj_m2', 'et0_mm'):
            r[k] = r2(r[k])
        for base in (0, 5, 6, 10):
            r[f'gdd_base{base}'] = round(max(0.0, r['tmean_c'] - base), 2)
    return rows


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
        crop_group_code=b['crop_group_code'], crop_group_name=b['crop_group_name'], year=b['year'],
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

def field_geometry(wkt):
    pts = [tuple(map(float, p.split())) for p in re.findall(r'(-?[\d.]+ -?[\d.]+)', wkt)]
    lat0, lon0 = LAYOUT_ORIGIN
    m_per_deg_lat = 111_320
    m_per_deg_lon = 111_320 * 0.6683  # cos(48.02°)
    ring = [[round(lon0 + x / m_per_deg_lon, 6), round(lat0 + y / m_per_deg_lat, 6)] for x, y in pts]
    lons, lats = [p[0] for p in ring[:-1]], [p[1] for p in ring[:-1]]
    return dict(type='Polygon', coordinates=[ring]), sum(lats) / len(lats), sum(lons) / len(lons)


def plan_rotation(parcels):
    """Give each field a rotation that ends on the dataset's crop for the last year."""
    plan, seen = {}, Counter()
    for p in parcels:
        crop = p['crop_current']
        cycle = ag.ROTATION_IRRIGATED if crop == 'MAIZ' else ag.ROTATION
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


def build_farm(ds, farm_id, today, weather_rows, catalogue, phones):
    holding = ds.holding(farm_id)
    nuts3 = holding['nuts3']
    parcels = ds.parcels(farm_id)
    weather = ag.Weather(weather_rows)
    out = defaultdict(list)

    # Fields
    fields = {}
    for i, p in enumerate(parcels, start=1):
        shape, lat, lon = field_geometry(p['shape_wkt'])
        fields[p['parcel_id']] = dict(
            id=i, name=FIELD_NAMES[i - 1] if i <= len(FIELD_NAMES) else f'Parcelle {i}', area_ha=r2(p['area_ha']),
            tenure=(p['tenure'] or '').lower() or None, irrigable=p['crop_current'] == 'MAIZ',
            irrigation_system_id=REEL_GUN['id'] if p['crop_current'] == 'MAIZ' else None,
            centroid_lat=round(lat, 6), centroid_lon=round(lon, 6), shape_geojson=shape, source_parcel_id=p['parcel_id'])
    out['field'] = list(fields.values())
    out['irrigation_system'] = [dict(REEL_GUN)] if any(f['irrigable'] for f in out['field']) else []
    farm_lat = sum(f['centroid_lat'] for f in out['field']) / len(out['field'])
    farm_lon = sum(f['centroid_lon'] for f in out['field']) / len(out['field'])

    out['farm'] = [dict(
        id=1, name=FARM_NAME, legal_form=FARM_LEGAL_FORM, nuts3_id=nuts3, lat=round(farm_lat, 6), lon=round(farm_lon, 6),
        uaa_ha=r2(holding['uaa_ha']), organic=bool(holding['organic']), farm_type=f"TF8 class {holding['farm_type_tf8']}",
        source_holding_id=farm_id,
        notes=('Fictional farm for the EU Agri Hackathon demo. Records come from the synthetic holding '
               f'{farm_id}, made realistic by seed.py. Weather, regional statistics and products are real.'))]

    # Members
    labour = sorted(ds.by_holding('labour', farm_id), key=lambda r: r['birth_year'])
    members = []
    for i, w in enumerate(labour):
        prof = MEMBER_PROFILES[i] if i < len(MEMBER_PROFILES) else dict(id=i + 1, full_name=f'Worker {i + 1}')
        members.append(dict(
            id=prof['id'], full_name=prof['full_name'], role=(w['worker_category'] or 'worker').lower(), phone=None,
            language='fr', birth_year=w['birth_year'], annual_hours=w['annual_hours'],
            certiphyto=prof.get('certiphyto', False), main_contact=prof.get('main_contact', False),
            notes=prof.get('notes')))
    members.sort(key=lambda m: m['id'])
    for m, phone in zip(members, phones):
        m['phone'] = phone or None
    out['member'] = members
    member_ids = {m['id'] for m in members}
    operator = {k: v if v in member_ids else None for k, v in OPERATOR.items()}

    # Soil
    for i, s in enumerate(ds.soil([p['parcel_id'] for p in parcels])):
        row = {k: r2(v) for k, v in s.items() if k != 'parcel_id'}
        out['soil_analysis'].append(dict(id=i + 1, field_id=fields[s['parcel_id']]['id'],
                                         sampled_on=date(2024, 9, 10) + timedelta(days=i), origin='dataset', **row))

    # Which synthetic records feed each crop season
    plan = plan_rotation(parcels)
    years = sorted({y for (_, y) in ds.season_records([parcels[0]['parcel_id']])})
    first_year, last_year = years[0], years[-1]
    donors = ds.donor_parcels(nuts3, holding['farm_type_tf8'], farm_id)
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
    op_id = inp_id = 0

    def add_op(**kw):
        nonlocal op_id
        op_id += 1
        out['operation'].append(dict(id=op_id, **kw))
        stats[f"op {kw['op_type']} {kw['status']}"] += 1
        return op_id

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
        water = float(irr.get('water_mm') or 0) if field['irrigable'] and crop == 'MAIZ' and irr.get('irrigated') else 0
        cs_id = len(seasons) + 1
        borrowed = src != pid
        seasons.append(dict(
            id=cs_id, field_id=field['id'], harvest_year=y, crop_code=crop, variety=pl['variety'],
            earliness_group=EARLINESS.get(crop),
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

        # Sprays: same number and types as the dataset, moved to the right stage, real products.
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
                product, use = catalogue.choose(crop, ptype, targets, key)
                if product is None:
                    stats[f'spray dropped (no product for {crop} {ptype})'] += 1
                    continue
                oid = add_op(**base, op_date=d, op_type='spraying', status='confirmed', member_id=operator['spraying'],
                             bbch=season.bbch(d), notes=label,
                             details=dict(source_table='synthetic_plant_protection', source_id=s['pp_id'],
                                          source_parcel=src, source_date=str(s['app_date']),
                                          source_product=s['product_name'], source_substance=s['active_substance'],
                                          source_dose=s['dose_l_or_kg_ha'], source_bbch=s['crop_stage_bbch']))
                inp_id += 1
                target = (use['identifiant usage'].split('*') + ['', '', ''])[2] or 'Désherbage'
                out['operation_input'].append(dict(
                    id=inp_id, operation_id=oid, product_id=product['id'], product_name=product['name'],
                    dose=round(num(use['dose retenue']) * ag.pick(DOSE_FACTORS, key, 'dose'), 2),
                    dose_unit=use['dose retenue unite'], target=target))

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
    out['subsidy'] = [dict(id=i + 1, year=s['year'], scheme=s['scheme'], amount_eur=r2(s['amount_eur']), origin='dataset')
                      for i, s in enumerate(ds.by_holding('subsidy', farm_id, 'year, scheme'))]
    econ_cols = ['total_output_eur', 'seeds_eur', 'fertiliser_eur', 'crop_protection_eur', 'energy_eur',
                 'contract_work_eur', 'wages_eur', 'depreciation_eur', 'total_inputs_eur', 'farm_net_value_added_eur']
    out['farm_economics'] = [dict(year=e['year'], origin='dataset', **{c: r2(e[c]) for c in econ_cols})
                             for e in ds.by_holding('farm_economics', farm_id, 'year')]
    prices = ds.market_prices(list(ag.CROPS))
    out['market_price'] = [dict(crop_code=m['product'], year=m['year'], month=m['month'],
                                price_eur_t=r2(m['price_eur_t'])) for m in prices]
    buyers = sorted({s['buyer_id'] for s in ds.by_holding('transaction_sale', farm_id)}) or ['BUYER-001']
    out['sale'] = build_sales(seasons, fields, prices, buyers, today)
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
            rows.append(dict(id=len(rows) + 1, sale_date=d, crop_code=crop, harvest_year=y,
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
        target = list(FAO_FILES) if only_fao else TABLES + list(FAO_FILES)
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

    if args.only_fao:
        print(f'Reading FAO-56 tables from {fao_dir}')
        tables = build_fao(fao_dir)
        for t in FAO_FILES:
            print(f'  {t:<22} {len(tables[t]):>4}')
        for w in warnings:
            print(f'  ! {w}')
        if args.dry_run:
            print('\nDry run: nothing written.')
            return tables
        write(db_url, tables, args.reset, args.yes, only_fao=True)
        return tables

    datasets_dir = os.environ.get('DATASETS_DIR')
    if not datasets_dir:
        raise SystemExit('Set DATASETS_DIR in .env (the folder dg-agri-hackathon-datasets).')
    farm_id = os.environ.get('FARM_ID') or 'FARM-02580'
    today = date.fromisoformat(os.environ['DEMO_TODAY']) if os.environ.get('DEMO_TODAY') else date.today()
    phones = [p.strip() for p in os.environ.get('MEMBER_PHONES', '').split(',')]

    print(f'Farm {farm_id}, demo date {today}')
    ds = Datasets(datasets_dir)
    holding = ds.holding(farm_id)

    print('Reading E-Phy (French product register)...')
    usages, ephy_file = ephy_usages(ROOT / '.cache')
    catalogue = Catalogue(usages, ephy_file)
    catalogue.add_preferred()

    print('Reading reference data and weather...')
    region, crop_ref, crop_stage, bench = build_reference(ds, holding['nuts3'])
    lat = LAYOUT_ORIGIN[0] + 0.02
    lon = LAYOUT_ORIGIN[1] + 0.03
    weather = build_weather(ds, holding['nuts3'], lat, lon, today)

    print('Building the farm...')
    tables = build_farm(ds, farm_id, today, weather, catalogue, phones)
    tables.update(region=[region], crop_ref=crop_ref, crop_stage=crop_stage, weather_daily=weather,
                  regional_benchmark=bench, product=list(catalogue.products.values()), product_use=catalogue.uses)
    if fao_dir.exists():
        tables.update(build_fao(fao_dir))
    else:
        warnings.append(f'FAO_DIR {fao_dir} not found: FAO-56 tables stay empty')

    print('\nRows to load:')
    for t in TABLES + list(FAO_FILES):
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
