# Fixtures

Demo data for TelliaForce, validated against the `@tellia/shared` schemas by
`fixtures.test.ts`. Screens never import these directly — they go through
`src/lib/api/`. Every mocked call is tagged `// MOCK:` with the real endpoint it
stands for; `grep -r "MOCK:" apps/web/src` lists what's left to wire.

## Numbers

The hero parcel **The Valley** (`oakfield/parcel-report.valley.json`) uses the
real campaign numbers (Loiret, Wed 13 July 2022, drought), with one deliberate
change from the prototype: the recommendation is **35 mm net** (≈ 44 mm gross),
not 40 — the FAO-56 engine caps a single application at 35 mm
(`MAX_APPLICATION_MM`). The "+water" column of `nextDays` is recomputed for
+35 mm (the prototype's flat model adds `netMm / usableMm` ≈ 24 pts, vs 28 for
40 mm). The reserve series reproduces the prototype curve (today 97 mm → Mon 55
mm, crossing the 79 mm comfort threshold on Fri).

## Placeholders (not real data)

- **The Well / Long Field** (Oakfield): names and crops are real intent, but
  `areaHa` and stages are invented — only The Valley is fully modelled.
- **Ridgeway Farm** (`ridgeway/*`): entirely a placeholder until real FARM-03527
  data lands. `live: false` in `farms.json` → no live chat for it.
