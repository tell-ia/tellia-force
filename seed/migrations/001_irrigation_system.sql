-- 001: irrigation equipment, linked from field. Same result as schema.sql + seed.py on a fresh database.
-- Safe to run twice.

create table if not exists irrigation_system (
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
alter table irrigation_system enable row level security;

insert into irrigation_system (name, system_type, efficiency, dose_min_mm, dose_max_mm, round_days, notes, origin)
values ('Reel gun 1', 'reel_gun', 0.75, 20, 40, 3, 'Hose reel with a water gun, shared by the irrigable fields.', 'invented')
on conflict (name) do nothing;

alter table field add column if not exists irrigation_system_id int references irrigation_system on delete set null;
create index if not exists field_irrigation_system on field (irrigation_system_id);

update field set irrigation_system_id = (select id from irrigation_system where name = 'Reel gun 1')
where irrigable and irrigation_system_id is null;
