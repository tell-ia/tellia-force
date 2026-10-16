-- FAO-56 reference tables for the soil water balance (Marceau's files, verified 16 Oct 2026).
-- Loaded by seed.py from FAO_DIR. Sources: Allen et al. 1998 (FAO-56) Tables 11, 12, 17, 19, 22;
-- FAO-33 / FAO-66 for Ky; Arvalis, Terres Inovia, Isagri, Chambre d'agriculture de Bretagne for degree-days.
-- Rows marked adapted, interpolated, derived or proxy are assumptions: say so in the pitch.

create table fao56_crop_stages (
  crop_code text primary key,
  crop_name text,
  crop_name_fao text,
  season_start_dataset text,
  harvest_window_dataset text,
  l_ini_days int,
  l_dev_days int,
  l_mid_days int,
  l_late_days int,
  l_total_days int,
  t_base_c numeric,
  t_max_cap_c numeric,
  dormancy_rule text,
  source text,
  verified_2026_10_16 text,
  adaptation_note text
);
comment on table fao56_crop_stages is 'FAO-56 Table 11: length in days of the 4 crop stages (ini, dev, mid, late), base temperature and Tmax cap for degree-days.';

create table fao56_kc (
  crop_code text primary key,
  crop_name text,
  kc_ini numeric,
  kc_mid numeric,
  kc_end numeric,
  h_max_m numeric,
  kcb_ini text,
  kcb_mid text,
  kcb_end text,
  kc_end_note text,
  source text,
  verified_2026_10_16 text,
  adaptation_note text
);
comment on table fao56_kc is 'FAO-56 Table 12: single crop coefficients Kc per stage (crop water use = ET0 x Kc). Kcb (Table 17) for the dual-Kc method, as text because some are ranges.';

create table fao56_root_depletion (
  crop_code text primary key,
  crop_name text,
  zr_ini_m numeric,
  zr_max_min_m numeric,
  zr_max_max_m numeric,
  zr_max_default_m numeric,
  p_table numeric,
  p_note text,
  source text,
  verified_2026_10_16 text,
  adaptation_note text
);
comment on table fao56_root_depletion is 'FAO-56 Table 22: root depth Zr (grows from zr_ini to zr_max over ini + dev) and depletion fraction p (RAW = p x TAW).';

create table fao56_soil_water (
  texture_class_usda text primary key,
  sand_pct_min numeric,
  sand_pct_max numeric,
  clay_pct_min numeric,
  clay_pct_max numeric,
  theta_fc_min numeric,
  theta_fc_max numeric,
  theta_fc_mid numeric,
  theta_wp_min numeric,
  theta_wp_max numeric,
  theta_wp_mid numeric,
  aw_mm_per_m_min numeric,
  aw_mm_per_m_max numeric,
  aw_mm_per_m_mid numeric,
  ze_m numeric,
  rew_mm_min numeric,
  rew_mm_max numeric,
  rew_mm numeric,
  source text,
  verified_2026_10_16 text
);
comment on table fao56_soil_water is 'FAO-56 Table 19: field capacity (theta_fc) and wilting point (theta_wp) per USDA texture class. TAW = 1000 x (theta_fc - theta_wp) x Zr. Sand and clay bounds are indicative.';

create table fao33_ky (
  crop_code text primary key,
  crop_name text,
  fao33_crop text,
  ky_season numeric,
  ky_vegetative numeric,
  ky_flowering numeric,
  ky_yield_formation numeric,
  ky_ripening numeric,
  ky_combined_notes text,
  fao56_phase_mapping text,
  source text,
  note text
);
comment on table fao33_ky is 'FAO-33 yield response factors Ky by growth period: 1 - Ya/Yx = Ky x (1 - ETa/ETx). The only basis for a theoretical yield-loss figure.';

create table stage_thresholds_gdd (
  id serial primary key,
  crop_code text not null,
  crop_name text,
  t_base_c numeric,
  t_max_cap_c numeric,
  anchor_stage text not null,
  earliness_group text,
  gdd_from_sowing_min numeric,
  gdd_from_sowing_max numeric,
  gdd_from_sowing_default text,
  gdd_from_sowing_default_num numeric,
  fao56_phase_boundary text,
  evidence_level text,
  source text,
  note text
);
comment on table stage_thresholds_gdd is 'Degree-days from sowing to each crop stage (published French sources), with evidence_level. Use published anchors first, FAO day lengths as fallback.';
comment on column stage_thresholds_gdd.earliness_group is 'Variety group this row is for (same values as crop_season.earliness_group). Empty = all groups. Set by seed.py from anchor_stage.';
comment on column stage_thresholds_gdd.gdd_from_sowing_default is 'Default value as written in the source file. Can be relative, for example "flowering + 590".';
comment on column stage_thresholds_gdd.gdd_from_sowing_default_num is 'The default as a number when it is a plain number; null when it is relative to another stage.';
create index stage_thresholds_gdd_crop on stage_thresholds_gdd (crop_code);

do $$
declare t text;
begin
  foreach t in array array['fao56_crop_stages', 'fao56_kc', 'fao56_root_depletion', 'fao56_soil_water',
    'fao33_ky', 'stage_thresholds_gdd']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
