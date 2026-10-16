#!/usr/bin/env python3
"""Apply one SQL migration to the database in DATABASE_URL, in one transaction.

    python migrate.py migrations/001_irrigation_system.sql

Use it to change the live database without a full --reset (which would rebuild every table).
Also update schema.sql and seed.py, so a fresh rebuild gives the same result.
"""

import sys
from pathlib import Path

import psycopg
from dotenv import load_dotenv
import os

load_dotenv(Path(__file__).resolve().parent / '.env')
if len(sys.argv) != 2:
    raise SystemExit(__doc__)
sql = Path(sys.argv[1]).read_text()
with psycopg.connect(os.environ['DATABASE_URL'], prepare_threshold=None, connect_timeout=20) as conn:
    print(f'Database: {conn.info.host}:{conn.info.port}/{conn.info.dbname}')
    with conn.transaction():
        conn.execute(sql)
    print(f'Applied {Path(sys.argv[1]).name}. The transaction is committed.')
