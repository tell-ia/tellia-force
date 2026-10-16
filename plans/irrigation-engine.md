# Irrigation engine v2 — FAO-56 with degree-day stages

Branch `feat/irrigation-engine-fao56`. Tests first (`apps/api/tests/*fao*`, `*reference_2022*`, `*dates*`, `*farm_rest*`).
Method: Marceau's FAO-56 doc + README (`seed/fao56/`), with the review decisions of 17 Oct.

## Method (what the code must do)

Per field, per day, from the sowing date:

1. **Degree-days**: `GDD = max(0, (min(Tmax, cap) + Tmin) / 2 − Tbase)` from `fao56_crop_stages`
   (maize, sunflower: base 6, cap 30; wheat, barley, rapeseed: base 0, cap 30). Summed **from sowing**.
2. **Phase** from the degree-days and `crop_phase_gdd` (end of ini / dev / mid / late, flowering, sensitive
   window), picked by `crop_season.earliness_group`. Published anchors where they exist, FAO days converted
   with Loiret 2020 weather elsewhere (computed by the seed, flagged `derived`).
3. **Kc**: FAO 4 segments on the degree-day axis (ini flat, dev linear, mid flat, late linear, Kc_end after).
4. **Root depth**: Zr_ini → Zr_max linearly over ini + dev, then constant. TAW = 1000 × (θFC − θWP) × Zr,
   θ from `fao56_soil_water` (Table 19) by USDA texture class; Saxton-Rawls only if no class row.
5. **p**: FAO-56 eq. 5, `p = clamp(p_table + 0.04 × (5 − ETc), 0.1, 0.8)`, capped in the sensitive window
   (maize flowering 0.45). RAW = p × TAW of the day.
6. **Balance**: `D = D_prev − rain − irrigation × efficiency + Ks × ETc`, rain counted in full, D floored at 0
   (the excess is **drainage**, reported), capped at TAW. D stays in mm when roots grow.
7. **Start**: D = 0 at sowing; dry regions (aridity P/ET0 < 0.5, e.g. Valladolid) start at 0.3 × TAW.
8. **Waterings**: only `confirmed`, only dated on or before the chosen date. `water_mm` is gross.

## Decision (order matters)

| Decision | When |
|---|---|
| `outside_season` | no crop between sowing and harvest |
| `not_irrigable` | field has no water access |
| `crop_maturing` ★ | late phase or mature: stop irrigating |
| `frost_hold` / `wait_for_rain` / `irrigate_today` | morning D ≥ RAW (existing rules) |
| `plan_irrigation` ★ | D reaches RAW within the system's round days: `irrigateBy` = that date |
| `no_irrigation` | otherwise, with `daysUntilIrrigation` if within 6 days |

Amounts: net need = D (refill to field capacity); gross = net ÷ efficiency, capped by `dose_max_mm` per pass
(net = gross × efficiency after the cap). Without an irrigation system: efficiency 1, old 35 mm cap.

## Dates

| `date` | Weather |
|---|---|
| past, covered by the DB | DB only, no API call |
| today, or past after the last seeded day | DB, then Open-Meteo for the missing days |
| future, up to today + 7 | Open-Meteo forecast (the engine reads 7 days ahead; Open-Meteo gives 14) |
| after today + 7 | 400 error |

## API

- `GET /irrigation/advice?farmId=&date=`, `GET /irrigation/fields/:id/report?farmId=&date=`,
  `POST /irrigation/fields/:id/simulate`. `farmId` defaults to farm 1. The chat stays on farm 1 (next PR).
- New report fields: `irrigateGrossMm`, `irrigateBy`, `headline` (one sentence for voice / SMS), `stage`
  (`phase`, `gddSinceSowing`, `sensitive`, `floweringDate`), `rootDepthM`, `soil` (`textureClass`, `tawMm`),
  `season` (rain, irrigation gross/net, ETc, drainage, stress days, days since sowing), `series`
  (10 days back, 5 ahead), `assumptions`. `DayBalance` gets `drainage` and `p`.
- No result cache in the DB: computing is fast, weather is already cached in memory, and stored results go
  stale. What we told the farmer is logged in `alert`, as an audit trail.

## Reference test (Marceau's case)

La Vallée 2022, maize `early` sown 3 May, sandy loam, 35 mm gross on 9 July, real AgERA5 Loiret weather.
On 13 July: flowering reached 12 July (854 °C·d), TAW 144 mm, D ≈ 49 mm (95 of 144 left; Marceau 97),
RAW ≈ 65 mm, threshold 15 July → `plan_irrigation` by 2022-07-15. Season to 12 July: rain 149 mm,
drainage 22 mm, 0 stress days.
