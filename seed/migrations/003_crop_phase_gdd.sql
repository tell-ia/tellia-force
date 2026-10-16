-- 003: crop_phase_gdd, the 4 stage boundaries per crop and earliness group (engine v2).
-- Adds ONE table; the other FAO tables are not touched. Rows generated from seed.py
-- (build_crop_phase_gdd), so a full --reset gives the same table. Safe to run twice.

create table if not exists crop_phase_gdd (
  id serial primary key,
  crop_code text not null,
  earliness_group text,
  ini_end numeric not null,
  dev_end numeric not null,
  mid_end numeric not null,
  late_end numeric not null,
  flowering numeric,
  sensitive_from numeric,
  sensitive_to numeric,
  sensitive_p numeric,
  method text not null
);
comment on table crop_phase_gdd is 'Degree-days from sowing at the end of each FAO-56 phase, per crop and variety group. The irrigation engine reads its crop stage here. Base temperature and Tmax cap: fao56_crop_stages. Built by seed.py.';
comment on column crop_phase_gdd.earliness_group is 'Variety group (same values as crop_season.earliness_group). Empty = default row of the crop, used when the season has no group or no row for its group.';
comment on column crop_phase_gdd.ini_end is 'End of the initial phase (about 10 % ground cover), in degree-days from sowing.';
comment on column crop_phase_gdd.dev_end is 'End of the development phase (full cover). Roots reach their maximum depth here.';
comment on column crop_phase_gdd.mid_end is 'End of mid-season (start of senescence). After it the crop is maturing: no more irrigation.';
comment on column crop_phase_gdd.late_end is 'End of the late phase (harvest maturity).';
comment on column crop_phase_gdd.flowering is 'Start of flowering, in degree-days from sowing. Empty if not known.';
comment on column crop_phase_gdd.sensitive_from is 'Start of the window where the crop is most sensitive to water stress (FAO-33). Empty = no window.';
comment on column crop_phase_gdd.sensitive_to is 'End of the sensitive window.';
comment on column crop_phase_gdd.sensitive_p is 'Highest depletion fraction p inside the sensitive window (RAW = p x TAW): the crop is watered earlier.';
comment on column crop_phase_gdd.method is 'Where the values come from: published, relative to flowering, derived (FAO days on Loiret 2019-20) or proxy.';
create unique index if not exists crop_phase_gdd_crop_group on crop_phase_gdd (crop_code, coalesce(earliness_group, ''));
alter table crop_phase_gdd enable row level security;

insert into crop_phase_gdd (crop_code, earliness_group, ini_end, dev_end, mid_end, late_end, flowering, sensitive_from, sensitive_to, sensitive_p, method)
select * from (values
  ('MAIZ', 'very_early', 320, 725, 1405, 1595, 815, 715, 1065, 0.45, 'Flowering published (Isagri, Arvalis); ini end 320 derived (5-6 leaves); dev end flowering - 90 derived; mid end flowering + 590 published (in the group range 1340-1410); late end flowering + 780 published (in the group range 1525-1625).'),
  ('MAIZ', 'early', 320, 760, 1440, 1630, 850, 750, 1100, 0.45, 'Flowering published (Isagri, Arvalis); ini end 320 derived (5-6 leaves); dev end flowering - 90 derived; mid end flowering + 590 published (in the group range 1390-1460); late end flowering + 780 published (in the group range 1630-1650).'),
  ('MAIZ', 'half_early_flint_dent', 320, 800, 1480, 1670, 890, 790, 1140, 0.45, 'Flowering published (Isagri, Arvalis); ini end 320 derived (5-6 leaves); dev end flowering - 90 derived; mid end flowering + 590 published (in the group range 1460-1540); late end flowering + 780 published (in the group range 1650-1750).'),
  ('MAIZ', 'half_early_dent', 320, 860, 1540, 1800, 950, 850, 1200, 0.45, 'Flowering published (Isagri, Arvalis); ini end 320 derived (5-6 leaves); dev end flowering - 90 derived; mid end flowering + 590 published (in the group range 1530-1600); late end 1800 = middle of the published group range 1775-1825.'),
  ('MAIZ', 'half_late', 320, 910, 1635, 1878, 1000, 900, 1250, 0.45, 'Flowering published (Isagri, Arvalis); ini end 320 derived (5-6 leaves); dev end flowering - 90 derived; mid end 1635 = middle of the published group range 1600-1670; late end 1878 = middle of the published group range 1830-1925.'),
  ('MAIZ', 'late', 320, 955, 1725, 1990, 1045, 945, 1295, 0.45, 'Flowering published (Isagri, Arvalis); ini end 320 derived (5-6 leaves); dev end flowering - 90 derived; mid end 1725 = middle of the published group range 1690-1760; late end 1990 = middle of the published group range 1930-2050.'),
  ('MAIZ', null, 320, 760, 1440, 1630, 850, 750, 1100, 0.45, 'Default = early group. Flowering published (Isagri, Arvalis); ini end 320 derived (5-6 leaves); dev end flowering - 90 derived; mid end flowering + 590 published (in the group range 1390-1460); late end flowering + 780 published (in the group range 1630-1650).'),
  ('SUNF', 'early', 221, 720, 1266, 1570, 950, 850, 1200, 0.45, 'Late end = full cycle published (Terres Inovia); flowering = cycle - 620 (published span); dev end flowering - 230 derived; mid end split by FAO days 45/25; ini end derived (FAO days on Loiret 2020).'),
  ('SUNF', 'half_early', 221, 790, 1336, 1640, 1020, 920, 1270, 0.45, 'Late end = full cycle published (Terres Inovia); flowering = cycle - 620 (published span); dev end flowering - 230 derived; mid end split by FAO days 45/25; ini end derived (FAO days on Loiret 2020).'),
  ('SUNF', 'normal', 221, 850, 1396, 1700, 1080, 980, 1330, 0.45, 'Late end = full cycle published (Terres Inovia); flowering = cycle - 620 (published span); dev end flowering - 230 derived; mid end split by FAO days 45/25; ini end derived (FAO days on Loiret 2020).'),
  ('SUNF', null, 221, 720, 1266, 1570, 950, 850, 1200, 0.45, 'Default = early group. Late end = full cycle published (Terres Inovia); flowering = cycle - 620 (published span); dev end flowering - 230 derived; mid end split by FAO days 45/25; ini end derived (FAO days on Loiret 2020).'),
  ('COWT', null, 298, 1539, 2174, 2650, 1739, 1567, 1768, 0.45, 'Dev end (booting), flowering, sensitive heading to end of flowering published (Isagri); late end 2650 derived; mid end split by FAO days 40/30; ini end derived (FAO days on Loiret 2019-20).'),
  ('BARL', null, 268, 1385, 1957, 2385, 1565, 1410, 1591, 0.45, 'Proxy: winter wheat row x 0.9 (no published barley sums).'),
  ('RAPE', null, 612, 2044, 2878, 3507, 2044, 2044, 2344, 0.5, 'All ends derived (FAO days on Loiret 2019-20); flowering = dev end; sensitive flowering to + 300, p 0.50.')
) as v(crop_code, earliness_group, ini_end, dev_end, mid_end, late_end, flowering, sensitive_from, sensitive_to, sensitive_p, method)
where not exists (select 1 from crop_phase_gdd);
