-- 002: variety earliness group, on crop_season and on the degree-day thresholds. Safe to run twice.

alter table crop_season add column if not exists earliness_group text
  check (earliness_group in ('very_early', 'early', 'half_early', 'half_early_flint_dent', 'half_early_dent',
                             'half_late', 'late', 'normal'));
comment on column crop_season.earliness_group is 'How early the variety is (seed bag or catalogue). Picks the degree-day thresholds in stage_thresholds_gdd. Maize: very_early, early, half_early_flint_dent, half_early_dent, half_late, late. Sunflower: early, half_early, normal. Empty for other crops.';
update crop_season set earliness_group = 'early'
where crop_code in ('MAIZ', 'SUNF') and earliness_group is null;

alter table stage_thresholds_gdd add column if not exists earliness_group text;
comment on column stage_thresholds_gdd.earliness_group is 'Variety group this row is for (same values as crop_season.earliness_group). Empty = all groups. Set by seed.py from anchor_stage.';
update stage_thresholds_gdd set earliness_group = case
    when anchor_stage like 'Female flowering - very early%' then 'very_early'
    when anchor_stage like 'Female flowering - early%' then 'early'
    when anchor_stage like 'Female flowering - half-early flint-dent%' then 'half_early_flint_dent'
    when anchor_stage like 'Female flowering - half-early dent%' then 'half_early_dent'
    when anchor_stage like 'Female flowering - half-late%' then 'half_late'
    when anchor_stage like 'Female flowering - late and very late%' then 'late'
    when anchor_stage like 'Full cycle sowing to harvest - early varieties%' then 'early'
    when anchor_stage like 'Full cycle - half-early varieties%' then 'half_early'
    when anchor_stage like 'Full cycle - normal varieties%' then 'normal'
  end
where crop_code in ('MAIZ', 'SUNF');
