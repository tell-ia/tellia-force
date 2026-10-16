"""Crop knowledge used by the seed.

Names, BBCH stages, crop coefficients (Kc), and the rules that move the
synthetic dates to realistic ones. These are simple approximations for a demo,
not agronomic advice.
"""

from bisect import bisect_left
from datetime import date, timedelta
import hashlib

# FAO-56 Kc values (Allen et al. 1998, table 12). gdd_base: usual French values.
CROPS = {
    'COWT': dict(
        group='CERE', winter=True, gdd_base=0, kc=(0.4, 1.15, 0.3),
        ephy=['Blé', 'Céréales à paille', 'Céréales'], sowing='Oct-Nov', harvest='Jul-Aug',
        names=dict(en='Winter wheat', fr="Blé tendre d'hiver", es='Trigo blando de invierno',
                   de='Winterweichweizen', it='Frumento tenero invernale', pt='Trigo mole de inverno')),
    'BARL': dict(
        group='CERE', winter=True, gdd_base=0, kc=(0.3, 1.15, 0.25),
        ephy=['Orge', 'Céréales à paille', 'Céréales'], sowing='Oct', harvest='Jun-Jul',
        names=dict(en='Winter barley', fr="Orge d'hiver", es='Cebada de invierno',
                   de='Wintergerste', it='Orzo invernale', pt='Cevada de inverno')),
    'RAPE': dict(
        group='LRAPE', winter=True, gdd_base=0, kc=(0.35, 1.05, 0.35),
        ephy=['Crucifères oléagineuses'], sowing='Aug-Sep', harvest='Jul',
        names=dict(en='Winter oilseed rape', fr="Colza d'hiver", es='Colza de invierno',
                   de='Winterraps', it='Colza invernale', pt='Colza de inverno')),
    'MAIZ': dict(
        group='LMAIZ', winter=False, gdd_base=6, kc=(0.3, 1.2, 0.35),
        ephy=['Maïs'], sowing='Apr-May', harvest='Sep-Oct',
        names=dict(en='Grain maize', fr='Maïs grain', es='Maíz grano',
                   de='Körnermais', it='Mais da granella', pt='Milho grão')),
    'SUNF': dict(
        group='SUNF', winter=False, gdd_base=6, kc=(0.35, 1.05, 0.35),
        ephy=['Tournesol'], sowing='Apr-May', harvest='Sep',
        names=dict(en='Sunflower', fr='Tournesol', es='Girasol',
                   de='Sonnenblume', it='Girasole', pt='Girassol')),
}

_CEREAL_STAGES = [
    (0.00, 0, 'Sowing', 'Semis'),
    (0.06, 9, 'Emergence', 'Levée'),
    (0.10, 12, '2 leaves', '2 feuilles'),
    (0.20, 21, 'Start of tillering', 'Début tallage'),
    (0.32, 30, 'Start of stem elongation', 'Épi 1 cm'),
    (0.44, 32, '2 nodes', '2 nœuds'),
    (0.59, 39, 'Flag leaf', 'Dernière feuille étalée'),
    (0.66, 55, 'Mid heading', 'Mi-épiaison'),
    (0.71, 65, 'Full flowering', 'Pleine floraison'),
    (0.81, 75, 'Medium milk', 'Grain laiteux'),
    (0.94, 87, 'Hard dough', 'Grain pâteux dur'),
    (1.00, 89, 'Fully ripe', 'Maturité complète'),
]

# (fraction of sowing-to-harvest degree-days, BBCH, label en, label fr)
STAGES = {
    'COWT': _CEREAL_STAGES,
    'BARL': _CEREAL_STAGES,
    'RAPE': [
        (0.00, 0, 'Sowing', 'Semis'),
        (0.05, 9, 'Emergence', 'Levée'),
        (0.15, 13, '3 leaves', '3 feuilles'),
        (0.27, 16, '6 leaves', '6 feuilles'),
        (0.35, 18, '8 leaves (rosette)', '8 feuilles (rosette)'),
        (0.47, 30, 'Start of stem elongation', 'Reprise, début montaison'),
        (0.51, 51, 'Flower buds visible', 'Boutons accolés'),
        (0.56, 60, 'First flowers', 'Premières fleurs'),
        (0.61, 65, 'Full flowering', 'Pleine floraison'),
        (0.73, 71, 'Pod development', 'Formation des siliques'),
        (0.85, 80, 'Start of ripening', 'Début maturation'),
        (0.95, 87, 'Ripening', 'Maturation avancée'),
        (1.00, 89, 'Fully ripe', 'Maturité complète'),
    ],
    'MAIZ': [
        (0.00, 0, 'Sowing', 'Semis'),
        (0.05, 9, 'Emergence', 'Levée'),
        (0.22, 16, '6 leaves', '6 feuilles'),
        (0.30, 30, 'Start of stem elongation', 'Début montaison'),
        (0.47, 55, 'Tasselling', 'Sortie des panicules'),
        (0.52, 65, 'Silking', 'Floraison femelle'),
        (0.60, 71, 'Blister', 'Grain formé'),
        (0.70, 75, 'Milk', 'Grain laiteux'),
        (0.85, 85, 'Dough', 'Grain pâteux'),
        (0.93, 87, 'Physiological maturity', 'Maturité physiologique'),
        (1.00, 89, 'Fully ripe', 'Maturité complète'),
    ],
    'SUNF': [
        (0.00, 0, 'Sowing', 'Semis'),
        (0.06, 9, 'Emergence', 'Levée'),
        (0.15, 12, '2 leaves', '2 feuilles'),
        (0.25, 16, '6 leaves', '6 feuilles'),
        (0.33, 30, 'Stem elongation', 'Élongation'),
        (0.40, 51, 'Bud visible', 'Bouton étoilé'),
        (0.52, 61, 'Start of flowering', 'Début floraison'),
        (0.57, 65, 'Full flowering', 'Pleine floraison'),
        (0.63, 69, 'End of flowering', 'Fin floraison'),
        (0.72, 75, 'Seed filling', 'Remplissage des graines'),
        (0.80, 80, 'Start of ripening', 'Début maturation'),
        (0.93, 87, 'Physiological maturity', 'Maturité physiologique'),
        (1.00, 89, 'Fully ripe', 'Maturité complète'),
    ],
}

# Spray windows per crop and product type: (BBCH min, BBCH max, not before MM-DD,
# E-Phy target words to prefer, short label). A season's sprays of one type are
# spread over these windows in order.
SPRAY_WINDOWS = {
    ('CEREAL', 'HERBICIDE'): [(10, 13, None, [], 'autumn weeds'), (21, 30, '02-20', [], 'spring weeds')],
    ('CEREAL', 'FUNGICIDE'): [(30, 32, '03-15', ['Piétin verse', 'Septoriose'], 'T1'),
                              (37, 39, None, ['Septoriose', 'Rouille'], 'T2'),
                              (55, 65, None, ['Fusarioses', 'Rouille'], 'T3')],
    ('CEREAL', 'INSECTICIDE'): [(11, 13, None, ['Pucerons', 'Cicadelles'], 'autumn aphids'),
                                (55, 69, None, ['Pucerons', 'Mouches'], 'ear pests')],
    ('RAPE', 'HERBICIDE'): [(0, 1, None, [], 'pre-emergence'), (14, 18, None, [], 'autumn weeds')],
    ('RAPE', 'FUNGICIDE'): [(16, 18, None, ['Phoma'], 'phoma'), (60, 65, None, ['Sclérotiniose'], 'sclerotinia')],
    ('RAPE', 'INSECTICIDE'): [(9, 14, None, ['Coléoptères'], 'flea beetle'),
                              (30, 51, '02-15', ['Coléoptères'], 'stem weevil, pollen beetle')],
    ('MAIZ', 'HERBICIDE'): [(0, 1, None, [], 'pre-emergence'), (13, 16, None, [], 'post-emergence')],
    ('MAIZ', 'FUNGICIDE'): [(51, 65, None, ['taches foliaires', 'Rouille'], 'leaf diseases')],
    ('MAIZ', 'INSECTICIDE'): [(55, 65, None, ['Pyrale', 'Chenilles'], 'corn borer')],
    ('SUNF', 'HERBICIDE'): [(0, 1, None, [], 'pre-emergence'), (12, 16, None, [], 'post-emergence')],
    ('SUNF', 'FUNGICIDE'): [(51, 65, None, ['Phomopsis', 'Phoma', 'Sclérotiniose'], 'phomopsis')],
    ('SUNF', 'INSECTICIDE'): [(9, 14, None, ['Pucerons'], 'aphids')],
}

# Mineral nitrogen windows: (BBCH min, BBCH max, not before MM-DD).
# Not before 1 Feb for winter crops (nitrates rules in France).
FERT_WINDOWS = {
    'COWT': [(21, 25, '02-01'), (30, 32, '03-01'), (37, 39, '04-01')],
    'BARL': [(21, 25, '02-01'), (30, 32, '03-01'), (32, 37, '03-15')],
    'RAPE': [(18, 30, '02-01'), (30, 51, '02-20'), (51, 60, '03-10')],
    'MAIZ': [(0, 0, None), (14, 16, None), (16, 18, None)],
    'SUNF': [(0, 0, None), (12, 16, None)],
}

# Real products that French farms often use, by crop and type. Names must match
# E-Phy exactly; the seed keeps only the ones with an authorised use on the crop.
PREFERRED_PRODUCTS = {
    ('CEREAL', 'HERBICIDE'): ['ATLANTIS PRO', 'ARCHIPEL DUO', 'AXIAL PRATIC', 'ALLIE STAR SX', 'DEFI'],
    ('CEREAL', 'FUNGICIDE'): ['ELATUS ERA', 'REVYSTAR XL', 'PROSARO', 'LIBRAX'],
    ('CEREAL', 'INSECTICIDE'): ['KARATE AVEC TECHNOLOGIE ZEON', 'DECIS PROTECH', 'MAVRIK JET'],
    ('RAPE', 'HERBICIDE'): ['NOVALL', 'COLZOR TRIO', 'MOZZAR', 'KERB FLO'],
    ('RAPE', 'FUNGICIDE'): ['PICTOR PRO', 'PROPULSE'],
    ('RAPE', 'INSECTICIDE'): ['KARATE AVEC TECHNOLOGIE ZEON', 'DECIS PROTECH', 'MAVRIK JET'],
    ('MAIZ', 'HERBICIDE'): ['CALLISTO', 'ELUMIS', 'ISARD', 'NISSHIN'],
    ('MAIZ', 'FUNGICIDE'): ['AMISTAR', 'PROPULSE', 'ELDORADO'],
    ('MAIZ', 'INSECTICIDE'): ['CORAGEN'],
    ('SUNF', 'HERBICIDE'): ['PULSAR 40', 'CHALLENGE 600', 'EXPRESS SX', 'ATIC AQUA', 'PROWL 400'],
    ('SUNF', 'FUNGICIDE'): ['AMISTAR GOLD', 'PICTOR ACTIVE', 'REVYDAS'],
    ('SUNF', 'INSECTICIDE'): ['MAVRIK JET', 'KARATE K'],
}

EPHY_FUNCTION = {'HERBICIDE': 'Herbicide', 'FUNGICIDE': 'Fongicide', 'INSECTICIDE': 'Insecticide'}

# Crop rotations used to replace the dataset's "same crop every year".
ROTATION = ['RAPE', 'COWT', 'BARL', 'SUNF', 'COWT', 'BARL']
ROTATION_IRRIGATED = ['MAIZ', 'MAIZ', 'COWT']

GOOD_SPRAY_WIND_M_S = 4.5   # daily mean at 10 m, a proxy for "calm enough"
GOOD_SPRAY_RAIN_MM = 1.0


def crop_family(crop):
    return 'CEREAL' if crop in ('COWT', 'BARL') else crop


def h(*parts):
    """Stable pseudo-random number in [0, 1) from any values."""
    digest = hashlib.md5('|'.join(map(str, parts)).encode()).hexdigest()
    return int(digest[:12], 16) / 16**12


def pick(seq, *parts):
    return seq[int(h(*parts) * len(seq))]


def kc_at(crop, frac):
    ini, mid, end = CROPS[crop]['kc']
    if frac < 0.2:
        return ini
    if frac < 0.45:
        return ini + (mid - ini) * (frac - 0.2) / 0.25
    if frac < 0.75:
        return mid
    return mid + (end - mid) * min(1.0, (frac - 0.75) / 0.25)


def crop_stage_rows():
    rows = []
    for crop, stages in STAGES.items():
        for frac, bbch, en, fr in stages:
            rows.append(dict(crop_code=crop, bbch=bbch, season_fraction=frac,
                             label_en=en, label_fr=fr, kc=round(kc_at(crop, frac), 2)))
    return rows


def shift_year(d, years):
    try:
        return d.replace(year=d.year + years)
    except ValueError:  # 29 February
        return d.replace(year=d.year + years, day=28)


class Weather:
    """Daily weather by date. Days we don't have (the future) use the 2015-2024 average of that day."""

    def __init__(self, rows):
        self.days = {r['date']: r for r in rows}
        sums = {}
        for r in rows:
            if r['date'].year > 2024:
                continue
            k = (r['date'].month, r['date'].day)
            s = sums.setdefault(k, dict(n=0, tmean_c=0.0, et0_mm=0.0, precip_mm=0.0, wind_m_s=0.0))
            s['n'] += 1
            for f in ('tmean_c', 'et0_mm', 'precip_mm', 'wind_m_s'):
                s[f] += float(r[f])
        self.normal = {k: {f: s[f] / s['n'] for f in ('tmean_c', 'et0_mm', 'precip_mm', 'wind_m_s')}
                       for k, s in sums.items()}

    def get(self, d):
        r = self.days.get(d)
        if r is not None:
            return r
        return self.normal.get((d.month, d.day)) or self.normal[(2, 28)]


class Season:
    """Stage model for one crop on one field: BBCH and Kc for any day between sowing and harvest."""

    def __init__(self, crop, sow, harvest, weather):
        self.crop, self.sow, self.harvest = crop, sow, harvest
        base = CROPS[crop]['gdd_base']
        cum, total = [], 0.0
        d = sow
        while d <= harvest:
            total += max(0.0, float(weather.get(d)['tmean_c']) - base)
            cum.append(total)
            d += timedelta(days=1)
        self.cum = cum
        self.total = total or 1.0
        self.stages = STAGES[crop]

    def fraction(self, d):
        i = (d - self.sow).days
        if i < 0:
            return 0.0
        if i >= len(self.cum):
            return 1.0
        return self.cum[i] / self.total

    def bbch(self, d):
        f = self.fraction(d)
        st = self.stages
        for (f0, b0, *_), (f1, b1, *_) in zip(st, st[1:]):
            if f <= f1:
                return int(b0 + (b1 - b0) * (f - f0) / (f1 - f0)) if f1 > f0 else b1
        return st[-1][1]

    def date_for_bbch(self, bbch):
        """First day when the crop reaches this BBCH stage."""
        st = self.stages
        frac = 1.0
        for (f0, b0, *_), (f1, b1, *_) in zip(st, st[1:]):
            if bbch <= b1:
                frac = f0 + (f1 - f0) * (bbch - b0) / (b1 - b0) if b1 > b0 else f1
                break
        i = bisect_left(self.cum, frac * self.total)
        return self.sow + timedelta(days=min(i, len(self.cum) - 1))

    def kc(self, d):
        return kc_at(self.crop, self.fraction(d))


def date_in_window(season, lo, hi, not_before, harvest_year, key):
    """A date between two BBCH stages, chosen at random but stable for `key`."""
    d0, d1 = season.date_for_bbch(lo), season.date_for_bbch(hi)
    if d1 < d0:
        d1 = d0
    d = d0 + timedelta(days=int(h(key, 'day') * ((d1 - d0).days + 1)))
    if not_before:
        mm, dd = map(int, not_before.split('-'))
        d = max(d, date(harvest_year, mm, dd))
    return d


def avoid_winter(d, sow, harvest_year, autumn, key):
    """No spraying from 15 Dec to 15 Feb: autumn work moves before, spring work after."""
    start, end = date(harvest_year - 1, 12, 15), date(harvest_year, 2, 15)
    if not start <= d <= end:
        return d
    if autumn:
        return max(sow + timedelta(days=5), start - timedelta(days=1 + int(h(key, 'winter') * 10)))
    return end + timedelta(days=1 + int(h(key, 'winter') * 10))


def calm_day(d, weather, lo, hi):
    """Nearest day (up to 4 days away) with little wind and no rain, else d."""
    for off in (0, 1, -1, 2, -2, 3, -3, 4, -4):
        x = d + timedelta(days=off)
        if x < lo or x > hi:
            continue
        w = weather.days.get(x)
        if w is None:
            return d
        if float(w['wind_m_s']) <= GOOD_SPRAY_WIND_M_S and float(w['precip_mm']) < GOOD_SPRAY_RAIN_MM:
            return x
    return d


def irrigation_events(season, weather, total_mm, key):
    """Split a yearly irrigation total into watering turns, using a simple soil water deficit.

    Deficit grows by crop water need (ET0 x Kc) minus useful rain. A turn of about
    30 mm is given when the deficit reaches the turn size, at least 5 days apart.
    """
    n = max(1, round(total_mm / 30))
    dose = round(total_mm / n, 1)
    start = season.date_for_bbch(14)
    end = min(season.date_for_bbch(85), season.harvest - timedelta(days=20))
    threshold = dose
    for _ in range(6):
        events, deficit, last = [], 0.0, None
        d = start
        while d <= end and len(events) < n:
            w = weather.get(d)
            rain = float(w['precip_mm'])
            deficit += float(w['et0_mm']) * season.kc(d) - (0.8 * rain if rain >= 3 else 0.0)
            deficit = max(0.0, deficit)
            if deficit >= threshold and (last is None or (d - last).days >= 5):
                events.append(d)
                deficit -= dose
                last = d
            d += timedelta(days=1)
        if len(events) == n:
            return [(e, dose) for e in events]
        threshold *= 0.6
    # Wet year: water anyway, every 7 days from the start of flowering.
    first = season.date_for_bbch(55)
    return [(first + timedelta(days=7 * i), dose) for i in range(n)]
