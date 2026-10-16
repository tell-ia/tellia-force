-- Farm assistant database: one demo farm, PostgreSQL (Supabase).
-- seed.py runs this file and then loads the data. Do not edit tables by hand:
-- change this file and seed.py, then run `python seed.py --reset` (see README.md).
--
-- Where the data comes from (column `origin` on the mixed tables):
--   dataset           copied from the EU Agri Hackathon synthetic tables
--   dataset_adjusted  synthetic records with dates, crops or products made realistic
--   generated         created by seed.py from rules (irrigation events, sales, next season)
--   invented          names and other details made up for the demo
-- Real data: weather (AgERA5, Open-Meteo), regional statistics (Eurostat-based
-- hackathon layers) and the French pesticide register (E-Phy, Anses).

-- ───────────── Reference data ─────────────

create table region (
  nuts3_id text primary key,
  name text not null,
  country_code text not null,
  centroid_lat double precision,
  centroid_lon double precision,
  climate_period text,
  mean_annual_precip_mm numeric,
  mean_april_sept_precip_mm numeric,
  mean_annual_et0_mm numeric,
  mean_annual_gdd_base5 numeric,
  mean_annual_frost_days numeric,
  mean_annual_heat_days numeric,
  mean_annual_dry_days numeric,
  topsoil_ph numeric,
  topsoil_organic_carbon_g_kg numeric,
  topsoil_clay_pct numeric,
  topsoil_sand_pct numeric,
  topsoil_silt_pct numeric,
  source text
);
comment on table region is 'The NUTS3 region of the farm, with climate normals and average topsoil. Real data.';

create table crop_ref (
  crop_code text primary key,
  crop_group_code text,
  name_en text not null,
  name_fr text not null,
  name_es text,
  name_de text,
  name_it text,
  name_pt text,
  ephy_crop_names text[],
  winter_crop boolean not null,
  gdd_base_c numeric not null,
  kc_ini numeric,
  kc_mid numeric,
  kc_end numeric,
  typical_sowing text,
  typical_harvest text
);
comment on table crop_ref is 'One row per crop: names in 6 languages, degree-day base temperature, FAO-56 crop coefficients (Kc).';
comment on column crop_ref.gdd_base_c is 'Base temperature for growing degree-days (GDD).';
comment on column crop_ref.kc_mid is 'FAO-56 crop coefficient at full cover. Crop water need = ET0 x Kc.';
comment on column crop_ref.ephy_crop_names is 'Crop names used in the French E-Phy register usages.';

create table crop_stage (
  crop_code text not null references crop_ref,
  bbch int not null,
  season_fraction numeric not null,
  label_en text not null,
  label_fr text not null,
  kc numeric not null,
  primary key (crop_code, bbch)
);
comment on table crop_stage is 'Simple stage model: BBCH stage reached at a fraction of the sowing-to-harvest degree-days. Approximation for the demo.';

create table weather_daily (
  date date primary key,
  tmin_c numeric,
  tmean_c numeric,
  tmax_c numeric,
  precip_mm numeric,
  rh_pct numeric,
  wind_m_s numeric,
  radiation_mj_m2 numeric,
  et0_mm numeric,
  gdd_base0 numeric,
  gdd_base5 numeric,
  gdd_base6 numeric,
  gdd_base10 numeric,
  source text not null
);
comment on table weather_daily is 'Real daily weather for the farm. 2015-2024: AgERA5 average of the region (hackathon dataset). From 2025: Open-Meteo at the farm location.';
comment on column weather_daily.et0_mm is 'Reference evapotranspiration (FAO-56), mm per day.';
comment on column weather_daily.wind_m_s is 'Daily mean wind speed at 10 m, m/s.';

create table regional_benchmark (
  crop_group_code text not null,
  crop_group_name text,
  year int not null,
  yield_t_ha numeric,
  yield_source_geography text,
  yield_value_type text,
  n_kg_ha numeric,
  p2o5_kg_ha numeric,
  k2o_kg_ha numeric,
  npk_reference_year int,
  irrigated_share numeric,
  pesticide_total_kg_ai_ha numeric,
  herbicide_kg_ai_ha numeric,
  fungicide_kg_ai_ha numeric,
  insecticide_kg_ai_ha numeric,
  pesticide_reference text,
  primary key (crop_group_code, year)
);
comment on table regional_benchmark is 'Real regional averages for the farm region: yield, fertiliser use (NPK) and pesticide use by crop group. Join with crop_ref.crop_group_code. Yields are regional proxies; maize (LMAIZ) yields may include green maize (fresh matter), so compare with care.';

create table market_price (
  crop_code text not null references crop_ref,
  year int not null,
  month int not null,
  price_eur_t numeric not null,
  primary key (crop_code, year, month)
);
comment on table market_price is 'Monthly reference price per crop, EUR per tonne. Synthetic (hackathon dataset).';

create table product (
  id serial primary key,
  name text not null,
  amm_number text unique,
  product_kind text not null,
  functions text,
  active_substances text,
  formulation text,
  holder text,
  source text not null
);
comment on table product is 'Crop protection products. Real products from the French E-Phy register (Anses).';
comment on column product.amm_number is 'French marketing authorisation number (AMM).';

create table product_use (
  id serial primary key,
  product_id int not null references product on delete cascade,
  crop_code text not null references crop_ref,
  usage_id text not null,
  target text,
  max_dose numeric,
  dose_unit text,
  max_applications int,
  pre_harvest_interval_days int,
  bbch_min int,
  bbch_max int,
  buffer_zone_water_m numeric,
  conditions text
);
comment on table product_use is 'Authorised uses of a product on a crop (E-Phy): max dose, max number of applications, days before harvest (DAR), buffer zone near water (ZNT).';

-- ───────────── The farm ─────────────

create table farm (
  id int primary key default 1 check (id = 1),
  name text not null,
  legal_form text,
  nuts3_id text references region,
  lat double precision,
  lon double precision,
  uaa_ha numeric,
  organic boolean not null default false,
  farm_type text,
  source_holding_id text,
  notes text
);
comment on table farm is 'The one demo farm. Fictional name; records based on synthetic holding source_holding_id.';

create table member (
  id serial primary key,
  full_name text not null,
  role text not null,
  phone text unique,
  language text not null default 'fr',
  birth_year int,
  annual_hours int,
  certiphyto boolean not null default false,
  main_contact boolean not null default false,
  notes text
);
comment on table member is 'People of the farm. phone (E.164, like +33612345678) identifies who sends a WhatsApp message or calls.';
comment on column member.certiphyto is 'Holds the French certificate to use crop protection products.';

create table irrigation_system (
  id serial primary key,
  name text not null unique,
  system_type text not null check (system_type in ('reel_gun', 'pivot', 'sprinkler', 'drip')),
  efficiency numeric not null check (efficiency > 0 and efficiency <= 1),
  dose_min_mm numeric,
  dose_max_mm numeric,
  round_days int,
  notes text,
  origin text not null
);
comment on table irrigation_system is 'Irrigation equipment. One machine can serve several fields (field.irrigation_system_id).';
comment on column irrigation_system.efficiency is 'Share of pumped water that reaches the roots. Net mm = gross mm x efficiency.';
comment on column irrigation_system.dose_max_mm is 'Most water one pass can apply, mm (gross). A bigger need is split into several passes.';
comment on column irrigation_system.round_days is 'Days to water all the fields it serves once. Start this many days before the stress threshold.';

create table field (
  id serial primary key,
  name text not null unique,
  area_ha numeric(8,2) not null,
  tenure text,
  irrigable boolean not null default false,
  irrigation_system_id int references irrigation_system on delete set null,
  centroid_lat double precision,
  centroid_lon double precision,
  shape_geojson jsonb,
  source_parcel_id text
);
comment on table field is 'Fields (parcels) of the farm. Names are invented. Shapes are schematic squares placed in the region.';
create index field_irrigation_system on field (irrigation_system_id);

create table soil_analysis (
  id serial primary key,
  field_id int not null references field on delete cascade,
  sampled_on date,
  ph_h2o numeric,
  organic_matter_pct numeric,
  soc_g_kg numeric,
  nitrogen_g_kg numeric,
  phosphorus_mg_kg numeric,
  potassium_mg_kg numeric,
  sulfur_mg_kg numeric,
  calcium_mg_kg numeric,
  magnesium_mg_kg numeric,
  zinc_mg_kg numeric,
  boron_mg_kg numeric,
  sand_pct numeric,
  silt_pct numeric,
  clay_pct numeric,
  cec_cmol_kg numeric,
  bulk_density_kg_dm3 numeric,
  lime_requirement_t_ha numeric,
  origin text not null
);
comment on table soil_analysis is 'Soil analysis per field. Values from the synthetic dataset; sampling date invented.';

create table crop_season (
  id serial primary key,
  field_id int not null references field on delete cascade,
  harvest_year int not null,
  crop_code text not null references crop_ref,
  variety text,
  earliness_group text check (earliness_group in ('very_early', 'early', 'half_early', 'half_early_flint_dent', 'half_early_dent', 'half_late', 'late', 'normal')),
  previous_crop_code text references crop_ref,
  sowing_date date,
  harvest_date date,
  status text not null check (status in ('planned', 'growing', 'harvested')),
  irrigated boolean not null default false,
  yield_t_ha numeric,
  moisture_pct numeric,
  protein_pct numeric,
  origin text not null,
  details jsonb,
  unique (field_id, harvest_year)
);
comment on column crop_season.earliness_group is 'How early the variety is (seed bag or catalogue). Picks the degree-day thresholds in stage_thresholds_gdd. Maize: very_early, early, half_early_flint_dent, half_early_dent, half_late, late. Sunflower: early, half_early, normal. Empty for other crops.';
comment on table crop_season is 'The crop on a field for one harvest year (winter crops are sown the autumn before). harvest_date is expected when status is not harvested.';

-- ───────────── Assistant ─────────────

create table message (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  member_id int references member,
  channel text not null check (channel in ('whatsapp', 'phone', 'web')),
  direction text not null check (direction in ('in', 'out')),
  kind text not null default 'text' check (kind in ('text', 'audio', 'call', 'image', 'document')),
  text text,
  transcript text,
  media_url text,
  external_id text,
  tool_calls jsonb,
  details jsonb
);
comment on table message is 'WhatsApp messages and phone calls with the assistant. transcript holds speech-to-text for audio and calls.';

-- ───────────── Farm journal ─────────────

create table operation (
  id bigserial primary key,
  field_id int not null references field on delete cascade,
  crop_season_id int references crop_season on delete set null,
  op_date date not null,
  op_type text not null check (op_type in ('sowing', 'fertilisation', 'spraying', 'irrigation', 'harvest', 'tillage', 'observation', 'other')),
  status text not null default 'confirmed' check (status in ('draft', 'confirmed', 'planned', 'cancelled')),
  source text not null default 'import' check (source in ('import', 'whatsapp', 'phone_call', 'web', 'agent')),
  member_id int references member,
  area_ha numeric,
  bbch int,
  fertiliser_type text,
  n_kg_ha numeric,
  p2o5_kg_ha numeric,
  k2o_kg_ha numeric,
  method text,
  water_mm numeric,
  variety text,
  seed_rate_kg_ha numeric,
  seed_origin text,
  yield_t_ha numeric,
  moisture_pct numeric,
  protein_pct numeric,
  notes text,
  message_id bigint references message on delete set null,
  origin text not null default 'agent',
  details jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table operation is 'Farm journal: every field operation. status=draft for records the assistant created and the farmer has not confirmed yet; planned for future work.';
comment on column operation.bbch is 'Crop stage (BBCH scale) on the operation date.';
comment on column operation.details is 'Extra data. For imported rows: the source record in the synthetic dataset.';
create index operation_field_date on operation (field_id, op_date);
create index operation_type_date on operation (op_type, op_date);

create table operation_input (
  id bigserial primary key,
  operation_id bigint not null references operation on delete cascade,
  product_id int references product,
  product_name text not null,
  dose numeric,
  dose_unit text,
  target text
);
comment on table operation_input is 'Products used in an operation (a tank mix has several rows). dose is per hectare.';
create index operation_input_operation on operation_input (operation_id);

create table alert (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  member_id int references member,
  field_id int references field,
  kind text not null,
  priority int not null default 2,
  title text not null,
  body text,
  due_date date,
  status text not null default 'new' check (status in ('new', 'sent', 'done', 'dismissed')),
  channel text,
  feedback text,
  details jsonb
);
comment on table alert is 'Actions the assistant proposes to the farmer (for example the 3 actions of the day), with status and feedback.';

create table document (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  kind text not null,
  title text not null,
  period_start date,
  period_end date,
  file_url text,
  content jsonb,
  member_id int references member
);
comment on table document is 'Documents produced by the assistant, for example the spray register.';

-- ───────────── Business ─────────────

create table sale (
  id serial primary key,
  sale_date date not null,
  crop_code text not null references crop_ref,
  harvest_year int not null,
  volume_t numeric not null,
  price_eur_t numeric not null,
  buyer text,
  contract_type text,
  quality_grade text,
  origin text not null
);
comment on table sale is 'Grain sales. Generated from the farm harvests and the synthetic monthly prices.';

create table subsidy (
  id serial primary key,
  year int not null,
  scheme text not null,
  amount_eur numeric not null,
  origin text not null
);
comment on table subsidy is 'CAP payments per year and scheme (BISS, CRISS, ECO_SCHEME, COUPLED, RURAL_DEV). Synthetic.';

create table farm_economics (
  year int primary key,
  total_output_eur numeric,
  seeds_eur numeric,
  fertiliser_eur numeric,
  crop_protection_eur numeric,
  energy_eur numeric,
  contract_work_eur numeric,
  wages_eur numeric,
  depreciation_eur numeric,
  total_inputs_eur numeric,
  farm_net_value_added_eur numeric,
  origin text not null
);
comment on table farm_economics is 'Yearly farm accounts. Synthetic.';

-- ───────────── Views for the assistant ─────────────

create view v_field_current with (security_invoker = true) as
select distinct on (f.id)
  f.id as field_id, f.name as field_name, f.area_ha, f.irrigable,
  cs.id as crop_season_id, cs.harvest_year, cs.crop_code, cr.name_en as crop_en, cr.name_fr as crop_fr,
  cs.status, cs.sowing_date, cs.harvest_date
from field f
left join crop_season cs on cs.field_id = f.id and cs.status in ('growing', 'planned')
left join crop_ref cr on cr.crop_code = cs.crop_code
order by f.id, case cs.status when 'growing' then 0 else 1 end, cs.harvest_year;
comment on view v_field_current is 'Each field with its crop in the ground (growing), or else the next planned crop.';

create view v_spray_register with (security_invoker = true) as
select o.id as operation_id, o.op_date, f.name as field_name, o.area_ha,
  cs.harvest_year, cr.name_fr as crop_fr, cr.name_en as crop_en, o.bbch,
  oi.product_name, p.amm_number, p.product_kind, oi.dose, oi.dose_unit,
  round(oi.dose * o.area_ha, 2) as quantity_total, oi.target,
  m.full_name as operator, w.wind_m_s, w.precip_mm, o.status, o.source
from operation o
join field f on f.id = o.field_id
join operation_input oi on oi.operation_id = o.id
left join product p on p.id = oi.product_id
left join crop_season cs on cs.id = o.crop_season_id
left join crop_ref cr on cr.crop_code = cs.crop_code
left join member m on m.id = o.member_id
left join weather_daily w on w.date = o.op_date
where o.op_type = 'spraying' and o.status in ('confirmed', 'draft');
comment on view v_spray_register is 'Spray register (registre phytosanitaire): one row per product applied, with daily weather.';

create view v_nutrients_by_season with (security_invoker = true) as
select cs.id as crop_season_id, f.name as field_name, f.area_ha, cs.harvest_year, cs.crop_code,
  coalesce(sum(o.n_kg_ha), 0) as n_kg_ha,
  coalesce(sum(o.p2o5_kg_ha), 0) as p2o5_kg_ha,
  coalesce(sum(o.k2o_kg_ha), 0) as k2o_kg_ha,
  cs.yield_t_ha,
  rb.n_kg_ha as regional_n_kg_ha,
  rb.yield_t_ha as regional_yield_t_ha
from crop_season cs
join field f on f.id = cs.field_id
join crop_ref cr on cr.crop_code = cs.crop_code
left join operation o on o.crop_season_id = cs.id and o.op_type = 'fertilisation' and o.status = 'confirmed'
left join lateral (
  select b.n_kg_ha, b.yield_t_ha from regional_benchmark b
  where b.crop_group_code = cr.crop_group_code
  order by abs(b.year - cs.harvest_year) limit 1
) rb on true
group by cs.id, f.name, f.area_ha, cs.harvest_year, cs.crop_code, cs.yield_t_ha, rb.n_kg_ha, rb.yield_t_ha;
comment on view v_nutrients_by_season is 'Fertiliser (N, P2O5, K2O kg/ha) per crop season, next to the regional average N use and yield.';

-- Row level security on, with no policies: the public Supabase API keys
-- (anon, authenticated) cannot read or write. The backend uses the database
-- connection (postgres role) or the service-role key, which skip RLS.
do $$
declare t text;
begin
  foreach t in array array['region', 'crop_ref', 'crop_stage', 'weather_daily', 'regional_benchmark',
    'market_price', 'product', 'product_use', 'farm', 'member', 'irrigation_system', 'field', 'soil_analysis', 'crop_season',
    'message', 'operation', 'operation_input', 'alert', 'document', 'sale', 'subsidy', 'farm_economics']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
