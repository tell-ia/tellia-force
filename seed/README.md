# Seed — the farm database

Rebuilds the whole Supabase database for the 3 demo farms (France, Spain, Italy): the hackathon dataset,
made realistic, plus real weather, real products and Marceau's FAO-56 tables. Python, about 2 minutes.

## Run it

You need Python 3.11+, the hackathon dataset folder (12 GB, not in git) and the Supabase
connection string (Supabase > Connect > Session pooler).

```bash
cd seed
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env                    # fill DATABASE_URL and DATASETS_DIR

.venv/bin/python seed.py --dry-run      # builds everything, writes nothing (~20 s)
.venv/bin/python seed.py --reset        # rebuilds every table in Supabase (~1 min)
```

- **One transaction**: if it fails, nothing changes.
- **`--reset` rewrites the shared database for the whole team.** Anything added by hand (live demo
  waterings, drafts) is lost. Tell the team first.
- `--only-fao` (with `--reset` to reload): only the 6 FAO-56 tables and `crop_phase_gdd`. Needs `DATASETS_DIR`
  too (Loiret reference weather, 2019 and 2020 files).
- Small change on the live database without a rebuild: write a file in `migrations/`, run
  `.venv/bin/python migrate.py migrations/00X_name.sql`, and put the same change in `schema.sql`
  and `seed.py`, so the next `--reset` gives the same result.

## What is in the database

**The farms** (fictional; `FARM_IDS` in `.env` picks them). Every farm table has a `farm_id` column.

| `farm.id` | Farm | Region | Fields | Irrigable fields (one reel gun per farm) | People (main contact first) |
|---|---|---|---|---|---|
| 1 | GAEC des Trois Chênes (`FARM-02580`) | Loiret, FR | 11, 64.9 ha | La Vallée, Le Puits (maize), Les Sablons (sunflower) | Claire (`member.id = 1`), Sophie, Monique, Camille |
| 2 | SAT Los Olmos (`FARM-07712`) | Valladolid, ES | 10, 60.6 ha | El Pozo, Las Eras (maize), La Hoya (sunflower) | Elena (`member.id = 5`), Javier, Carmen, Lucía |
| 3 | Società Agricola Ca' dei Pioppi (`FARM-08422`) | Bologna, IT | 14, 82.9 ha | Il Pozzo, La Torre (maize), Le Valli (sunflower) | Marco (`member.id = 9`), Paolo, Giulia |

Crops: wheat, barley, rapeseed, maize, sunflower. Members speak the farm language (`farm.language`: fr, es, it).
Maize earliness: `early` in Loiret, `late` in Spain and Italy (longer season).

| Group | Tables | Notes |
|---|---|---|
| Farm | `farm`, `member`, `field`, `soil_analysis`, `irrigation_system` | `member.phone` = who calls or writes, and so which farm. `field.irrigation_system_id` → the reel gun |
| Seasons | `crop_season` | One row per field and harvest year, 2017–2027. `earliness_group` for maize and sunflower (`early`) |
| Journal | `operation`, `operation_input` | Sowing, fertiliser, spraying, irrigation, harvest. Aug 2016 → Oct 2026, plus planned work |
| Weather | `weather_daily` | Real, daily, **per region** (`nuts3_id`, join `farm.nuts3_id`), 1 Jan 2015 → seed day. ET0, rain, Tmin, Tmean, Tmax, wind, degree-days |
| FAO-56 | `fao56_crop_stages`, `fao56_kc`, `fao56_root_depletion`, `fao56_soil_water`, `fao33_ky`, `stage_thresholds_gdd`, `crop_phase_gdd` | Marceau's tables (see `fao56/fao56_README.md`). `stage_thresholds_gdd.earliness_group` joins `crop_season.earliness_group` |
| Products | `product`, `product_use` | 34 real products from the French E-Phy register, with max dose, days before harvest, buffer zones. France only: Spanish and Italian sprays keep the synthetic substance code, named `... (synthetic)` |
| Region | `region`, `regional_benchmark` | Real averages per region (`nuts3_id`): climate, topsoil, yield and N per crop group |
| Business | `sale`, `subsidy`, `farm_economics`, `market_price` | Synthetic. Sales are generated from harvests; unsold grain = stock |
| Assistant | `message`, `alert`, `document` | Empty, filled by the app |
| Old | `crop_ref`, `crop_stage` | My first simple stage model. Replace with the FAO-56 tables |

`crop_phase_gdd` is built by `seed.py`, not read from a file: degree-days from sowing at the end of each FAO-56 phase
(ini, dev, mid, late), flowering and the sensitive window, per crop and `earliness_group` (empty = default row).
Published anchors first, FAO day lengths on a real Loiret 2019-20 season elsewhere; `method` says which.

Views: `v_field_current`, `v_spray_register`, `v_nutrients_by_season`.
Row level security is on with no policies: the public key reads nothing; the API uses the secret key.

## Rules for the code

- **Always filter by `farm_id`** (fields, members, operations, seasons…) and join weather and benchmarks
  on the farm region (`farm.nuts3_id`). Otherwise farms and countries get mixed.
- **Inserts may leave `farm_id` empty** on `operation`, `operation_input`, `crop_season`, `soil_analysis`,
  `message`, `alert` and `document`: a trigger copies it from the field, operation or member.
- **`operation.water_mm` is gross** (what the farmer pumped). Net water = gross × `irrigation_system.efficiency` (0.75).
- **Only maize and sunflower get irrigation advice** (`IRRIGATED_CROPS`, here and in `irrigation.service.ts`).
  Every field has the reel gun, but wheat, barley and rapeseed are grown rain-fed: the engine answers
  `not_irrigable` ("rain-fed crop") for them.
- **Only `status = 'confirmed'` operations count.** `draft` = recorded by the assistant, not confirmed yet.
- **`origin`** says where a row comes from: `dataset`, `dataset_adjusted`, `generated` or `invented`.
- **`crop_season.status` is computed on seed day.** For another date, use `sowing_date` and `harvest_date`.
- **Demo dates**: any date from 2015 to about 7 days before the seed day (the engine reads 7 days ahead).
- **Summer 2026 is the driest in the Loiret data**: June–August 79 mm of rain for a maize need of about 604 mm.
  La Vallée has maize in 2026 (sown 16 April), watered on 21 June, 27 June and 4 July.

## Where the data comes from

- **Synthetic, made realistic by `seed.py`**: crop rotation added (the dataset kept one crop per field
  for 10 years); sprays and fertiliser moved to the right crop stage with real degree-days; no spray
  after harvest; fake product names replaced by real E-Phy products; yearly irrigation totals split into
  dated waterings with a water balance; rapeseed sown in late August.
- **Invented**: farm, field and people names; the reel gun settings; the earliness group; which sunflower
  fields are irrigable (the ones the dataset irrigated at least 5 years out of 10).
- **Real**: weather (AgERA5 regional average to 2024, then Open-Meteo at the farm), E-Phy for France
  (downloaded from data.gouv.fr), regional statistics (hackathon layers), FAO-56 (Marceau, checked against the FAO text).

## Limits to say in the pitch

- The synthetic records do not react to weather or inputs: real insights come only from real data.
- Waterings before the demo were generated from yearly totals, not recorded by a farmer.
- Weather from 2025 is a point at the farm; before, a regional average. Comparisons across years are approximate.
- Names and settings marked `invented` are made up.

## Files

| File | What |
|---|---|
| `seed.py` | Main script: reads, cleans, writes |
| `agronomy.py` | Crops, stages, spray and fertiliser windows, irrigation turns |
| `sources.py` | Reads the dataset (DuckDB), Open-Meteo and E-Phy |
| `schema.sql`, `schema_fao.sql` | Tables, comments, views, row level security |
| `migrate.py`, `migrations/` | Changes applied to the live database |
| `fao56/` | Marceau's FAO-56 CSV files and README |
