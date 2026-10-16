# `get_parcel_report` contract — for the data endpoint

The parcel detail screen (and the chat's parcel widgets) render **one shape**:
`ParcelReport` in `@tellia/shared` (`packages/shared/src/app.ts`, type
`ParcelReport`). The data endpoint `get_parcel_report` must return exactly this.

- **Golden sample** (the fixture the UI is built against):
  `apps/web/src/fixtures/oakfield/parcel-report.valley.json` — The Valley,
  Loiret, Wed 13 Jul 2022. Match its shape field-for-field; the UI parses every
  response with the Zod schema and fails loud on drift.
- **Validation / versioning**: the top-level `schemaVersion` must equal
  `PARCEL_REPORT_VERSION` (currently `"v0"`). The app calls `parseParcelReport()`
  which returns `null` on a version mismatch (graceful fallback) rather than
  crashing. Bump the version only on a breaking shape change.
- **Ids**: `id` is the numeric `fieldId`; `farmId` the backend farm id.

## Shape (summary — the schema is the source of truth)

```
ParcelReport {
  schemaVersion: "v0"
  id, farmId: number            // fieldId, farm id
  name, cropName: string
  areaHa: number
  sownOn, asOf: "YYYY-MM-DD"
  recommendation { decision, headline, netMm, grossMm, efficiency, reason, secondPass|null }
  reserve { availableMm, capacityMm, pct, thresholdMm, thresholdPct, thresholdLabel, usedByThresholdMm }
  series: [ { date, dayLabel, rain, irrigation, cropUse, reserveMm, forecast } ]   // daily, past + forecast
  cropStage { label, daysSinceSowing, gdd, gddBase, useTodayMm, useTomorrowMm, note, progress(0..1), steps:[{label,weight,current}] }
  soil { texture, sandPct, siltPct, clayPct, omPct, usableMm, rootDepthM, note }
  seasonBalance { rainMm, irrigatedMm, cropUseMm, drainedMm, stressDays, cropDays }
  nextDays: [ { day, tempMax, pctNoWater, pctWatered } ]   // 5 rows
  method: string                // footnote
}
```

## Notes on the numbers (FAO-56)

- `reserve.availableMm = tawMm − depletionMm`, `thresholdMm = tawMm − rawMm`,
  `pct = 100 − depletionPct`. (See `fieldReportToReserve` in
  `apps/web/src/lib/mappers/parcel.ts`, unit-tested on the demo numbers.)
- `series[].reserveMm` = `tawMm − depletion` that day; `forecast:true` after
  `asOf`. This drives the reserve chart — **this is the series the fast
  `/irrigation/fields/:id/report` endpoint does not return today** (open item:
  expose it via a baseline `simulate` or a dedicated endpoint).
- `nextDays[].pctWatered` = reserve % if the recommended dose is applied
  (prototype model: `pctNoWater + round(netMm / usableMm * 100)`, capped 100).
- Single application is capped at **35 mm** (`MAX_APPLICATION_MM`), so
  `recommendation.netMm ≤ 35` and `grossMm = round(netMm / 0.8)`.

## For the chat agent (Imad)

`widgetJsonSchemas()` in `@tellia/shared` returns a JSON Schema per widget
(`recommendation`, `reserve`, `waterBalance`, `cropStage`, `nextDays`,
`seasonBalance`, `soil`, `parcelReport`). Use these as the `show_widget` tool
definition so the LLM can only emit valid widget props — numbers stay from the
engine, never invented.
