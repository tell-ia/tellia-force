# Migrations

SQL changes applied to the live database without a full rebuild (`python migrate.py migrations/00X_name.sql`).
Put the same change in `schema.sql` and `seed.py`, so the next `--reset` gives the same result.

001 (irrigation_system) and 002 (earliness_group) are now part of `schema.sql`: the multi-farm rebuild replaced them.
