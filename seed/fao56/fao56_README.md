# FAO-56 tables for the soil water balance — 7 crops of the dataset

Source: Allen, Pereira, Raes, Smith (1998), *Crop evapotranspiration — Guidelines for computing crop water requirements*, FAO Irrigation and Drainage Paper 56. Tables 11 (stage lengths), 12 (crop coefficients), 19 (soil water characteristics), 22 (rooting depth and depletion fraction).

Values flagged "adapted" in the `adaptation_note` column are not in FAO-56 as such: they were derived to fit the dataset calendar (October sowing for barley and rapeseed, hay cut three times, perennial olive). Cite them as assumptions, not references.

## Verification log — 16 October 2026

**1. Checked against the FAO-56 text online** (fao.org/4/x0490e, chapters 6, 7 and 8). Every FAO row in `fao56_kc.csv`, `fao56_crop_stages.csv`, `fao56_root_depletion.csv` and `fao56_soil_water.csv` now carries `verified_2026_10_16 = yes`; rows that FAO does not cover are marked `adapted` or `interpolated`. Corrections made:
- Wheat Kc_end: FAO footnote 10 says 0.4 is for *hand-harvested* crops (not "early harvest"); default kept at 0.30.
- Barley Kc_ini 0.30 confirmed as the FAO cereal-group default (the barley row has no own value).
- Grass hay: stage lengths changed from 10/20/30/10 to the FAO alfalfa first-cutting-cycle 10/20/20/10 (60 d); pasture Zr range widened to the FAO 0.5–1.5 m.
- Maize and sunflower T_base changed from 8 to 6 °C with Tmax capped at 30 °C, the Arvalis / Terres Inovia convention, so that published French thermal sums can be used directly.
- REW per texture class replaced by the FAO Table 19 ranges and midpoints; available-water ranges added.
- Basal coefficients Kcb (FAO Table 17) added for an optional dual-Kc implementation.
- Confirmed: FAO Table 11 has **no** winter barley and **no** rapeseed row; Table 12 Kc, Table 22 Zr and p, Table 19 θ values all match.

**New file `fao33_ky.csv`** — yield response factors from FAO-33 (Doorenbos & Kassam 1979) as reproduced in FAO-66 (*Crop yield response to water*, 2012, Tables 1–2 and Figure 1): maize 1.25 seasonal, 0.40 / **1.50** / 0.50 / 0.20 by period; winter wheat 1.00–1.05, 0.20 / 0.60 / 0.50; sunflower 0.95, 0.40 / 1.00 / 0.80; alfalfa 1.1 seasonal. Barley uses wheat as a proxy; rapeseed and olive have no FAO-33 Ky. These justify the "critical period" messages and are the only legitimate basis for a yield-loss figure: `1 − Ya/Yx = Ky × (1 − ETa/ETx)`.

**2. New file `stage_thresholds_gdd.csv`** — thermal-time anchors per crop with an `evidence_level` column (`published`, `published (secondary)`, `derived`, `proxy`, `FAO days`):
- Maize is well covered: sowing → female flowering 790–835 / 825–870 / 850–930 °C·d base 6 for very-early / early / half-early varieties; flowering → grain at 35 % moisture 730–800; sowing → grain harvest 1525–1750 (Chambre d'agriculture de Bretagne, July 2024, citing Arvalis). Emergence ≈ 80–90, one new leaf every ≈ 44 °C·d.
- Sunflower: full cycle 1500–1770 (1570 for early varieties, Terres Inovia 2019); flowering → whole-plant harvest 550–700 (Arvalis). Sowing → flowering is **derived** (≈ 950), not published: verify.
- Winter wheat: ear 1 cm 650–1250 °C·d base 0 (Arvalis, wide because of variety and sowing date); heading ≈ 2000 and 2 nodes ≈ 1300 come from secondary sources, not Arvalis: verify with Arvalis stage tools.
- Barley: no published sums found → wheat anchors minus ~10 %, flagged proxy. Rapeseed: only a full-cycle 2330 °C·d base 0 (SEMAE). Olive and hay: FAO day lengths.
- The engine should use the `published` anchors where they exist and fall back to the FAO day-to-GDD conversion described in section 1 elsewhere.

**3. Benchmark against a reference implementation** — `validate_against_pyfao56.py` runs the same La Vallée 2022 case (maize, sandy loam, 35 mm on 9 July) through **pyfao56** (USDA-ARS open-source FAO-56 implementation, dual Kc) and through this engine:
- Root-zone depletion series: correlation **0.995**, mean absolute difference **7.6 mm** over the season.
- RAW on 13 July: 68.7 mm (pyfao56) vs 68.2 mm (ours).
- Seasonal potential ETc 546 mm; actual ET 386 mm (pyfao56 dual Kc) vs 357 mm (ours, single Kc). The gap is soil evaporation after rain, which the dual-Kc method computes separately; it is the expected difference between the two FAO-56 variants.
- First stress day: 16 July in both when rain is counted in full.

**Sensitivity finding (`sensitivity_rain_rule.py`)** — the effective-rainfall rule is the most influential assumption in the whole chain. With rain counted in full (pyfao56's default, FAO-56 eq. 85 with runoff = 0), depletion on 13 July is **42 mm** and the trigger falls on **16 July**; with the "80 % above 5 mm" rule it is **68 mm** and the trigger falls on **13 July**. Both say "irrigate this week", but three days apart. Recommendation: do **not** apply a flat 80 % reduction; count rain in full and model losses explicitly (runoff via the SCS curve-number option, drainage via the balance). The mockup dashboard dated 13 July used the 80 % rule; with full rain the same screen would read "irrigate by Saturday 16".
- The p cap at 0.45 during flowering shifts the trigger by less than a day in this case.

**Update, same day — sowing-to-flowering sums checked again:**
- **Wheat: confirmed.** A full base-0 table (Isagri thermal-time article) gives cumulative degree-days from sowing: emergence 180, end of tillering 967, flag leaf 1255, booting complete 1539, **start of heading 1567**, ear fully emerged 1682, **start of flowering 1739**, end of flowering 1768, milky ripe 1825. Consistent with Arvalis ear-1 cm 650–1250. These replace the earlier "~2000 for heading" secondary figure. Harvest maturity remains derived.
- **Maize: confirmed and extended.** The Isagri table matches the Chambre de Bretagne / Arvalis values and adds the late groups: flowering 790–835 / 825–870 / 850–930 / 920–975 / 975–1020 / 1020–1070 °C·d base 6 across six earliness groups; silage maturity 1340–1760; grain harvest 1525–2050. Phase durations: emergence 80 (+40–50 in cold soil), 40–45 per leaf, silk elongation to flowering 200, flowering to end of grain-abortion risk 200–250, 20 °C·d per 1 % grain moisture lost.
- **Sunflower: not published.** Terres Inovia gives the full cycle by earliness (1570 / 1640 / 1700 °C·d base 6) and emergence ≈ 90; Arvalis gives flowering → harvest 550–700. No source (Terres Inovia, Arvalis, MAS Seeds, APAD, Isagri) publishes a sowing → F1 sum: it is variety dependent. The engine uses the derived 950 / 1020 / 1080 by earliness and should recalibrate on the farmer's observed F1 date.
- Barley and rapeseed: still no stage sums; proxies kept and flagged.

**Demo case recomputed** with rain counted in full, base 6 and the published maize anchors (early variety, flowering 850): on 13 July 2022 La Vallée holds 97 mm of 144 (67 %), threshold 79 mm, flowering reached on 12 July (854 °C·d), first trigger **Friday 15 July**; second round around 19 July. Season to date: rain 149, irrigation 35, ETc 209, drainage 22 mm (June rains), 0 stress days. The mockups were updated accordingly.

**Open item**: CropWat itself (Windows) was not run — pyfao56 was used as the reference instead.

### Sources used for the verification
- FAO-56, Allen et al. 1998 — chapter 6 (Tables 11, 12): https://www.fao.org/4/x0490e/x0490e0b.htm ; chapter 7 (Tables 17, 19): https://www.fao.org/4/x0490e/x0490e0c.htm ; chapter 8 (Table 22, eq. 82–85): https://www.fao.org/4/x0490e/x0490e0e.htm
- FAO-66, Steduto et al. 2012, chapter 2 "Yield response to water: the original FAO water production function" (reproduces FAO-33 Ky): https://www.fao.org/4/i2800e/i2800e02.pdf
- Chambre d'agriculture de Bretagne, "Besoins en somme de température (degrés-jours base 6) du semis à la récolte", 12 July 2024 (citing Arvalis)
- Arvalis, "Floraison du maïs : c'est pour quand ?" (790–955 °C·d base 6-30 by earliness): https://www.arvalis.fr/infos-techniques/floraison-du-mais-cest-pour-quand
- Arvalis, "Stade épi 1 cm" (650–1250 °C·d base 0): https://www.arvalis.fr/infos-techniques/stade-epi-1-cm-un-marqueur-determinant-savoir-reperer
- Terres Inovia / Terre-net, sunflower thermal sum 1570 °C·d base 6 (2019): https://www.terre-net.fr/terres-inovia/article/138463/tournesol-des-conditions-climatiques-favorables-dans-l-ouest-de-la-france
- SEMAE Pédagogie, winter rapeseed 2330 °C·d base 0: https://www.semae-pedagogie.org/sujet/implantation-et-developpement/
- Isagri, "Temps thermique : l'indicateur clé de prévision des stades de culture" (wheat base-0 stage table; maize table by earliness): https://www.isagri.fr/ressources/articles/temps-thermique-lindicateur-cl%C3%A9-de-pr%C3%A9vision-des-stades-de-culture
- APAD, "La culture du tournesol" (emergence ≈ 90 °C·d base 6): https://www.apad.asso.fr/172-l-instant-technique/378-la-culture-du-tournesol
- pyfao56 (USDA-ARS), Thorp et al.: https://github.com/kthorp/pyfao56

## The four files

| File | Role in the balance | Key |
|---|---|---|
| `fao56_crop_stages.csv` | Length of the 4 growth stages → stage and daily Kc | `crop_code` |
| `fao56_kc.csv` | Crop coefficients Kc_ini / Kc_mid / Kc_end → daily water demand | `crop_code` |
| `fao56_root_depletion.csv` | Rooting depth Zr and depletion fraction p → reservoir size and trigger threshold | `crop_code` |
| `fao56_soil_water.csv` | Field capacity and wilting point per texture class → available water per parcel | USDA class, derived from `sand_pct` / `clay_pct` in `synthetic_soil` |

`crop_code` is the dataset code (`COWT`, `BARL`, `RAPE`, `MAIZ`, `SUNF`, `OLIV`, `HAY`).

## 1. Stage: from days since sowing to the daily Kc

FAO-56 splits the cycle into four stages:

- **ini** (initial): sowing to ~10 % ground cover. Kc = Kc_ini, constant.
- **dev** (development): 10 % to full cover. Kc rises linearly from Kc_ini to Kc_mid.
- **mid** (mid-season): full cover until the start of senescence. Kc = Kc_mid, constant.
- **late** (late season): until harvest. Kc falls linearly from Kc_mid to Kc_end.

Kc on day J, with `d` = days since `plant_date`:

```
if d <= L_ini                         : Kc = Kc_ini
if d <= L_ini + L_dev                 : Kc = Kc_ini + (d - L_ini) / L_dev * (Kc_mid - Kc_ini)
if d <= L_ini + L_dev + L_mid         : Kc = Kc_mid
if d <= L_total                       : Kc = Kc_mid + (d - L_ini - L_dev - L_mid) / L_late * (Kc_end - Kc_mid)
else (after harvest)                  : bare soil, Kc ≈ 0.15 to 0.30 depending on surface wetness
```

**Days or degree days?** FAO-56 gives days. Day lengths are right for the climate they were established in and drift elsewhere. To account for the real climate of the region (the strength of the AgERA5 data), convert each stage to degree days:

1. For each crop, pick a reference region and year (e.g. Loiret 2020 for wheat).
2. Accumulate `max(T_mean − t_base, 0)` from sowing on `weather_daily` and record the total reached at the end of each stage according to the day lengths.
3. Those totals become the stage thresholds. In other regions and years the stage advances at the real pace of temperature: faster in Catanzaro, slower in Bayreuth.

`t_base_c` is given in `fao56_crop_stages.csv`. For winter crops (wheat, barley, rapeseed) the dev stage spans the winter: the base-0 degree-day total advances very slowly from December to February, which naturally reproduces the growth pause. Do not use `gdd_annual` from `synthetic_field_weather` or `annual_gdd_base_5_c`: these are annual totals, not accumulations since sowing.

**Special cases**
- **OLIV**: perennial. The dataset `plant_date` (early March) marks the season start, not a planting. Outside the 270 days, Kc = Kc_end (0.70) all year; Zr constant.
- **HAY**: cut grassland. After each cut (the `harvest` dates are spread over June / July / August), restart at `d = 0` of the 70-day cycle: Kc drops to 0.40 then rises. Between 1 March and the first cut, use the full cycle.
- **Autumn sowing** (COWT, BARL, RAPE): `plant_date` is in October-November of the year before `year`. The balance starts on that date, not on 1 January.

## 2. Daily water demand

```
ETc(J) = Kc(J) × ET0(J)
```

`ET0(J)` = `reference_evapotranspiration_mm` from `weather_daily` for the parcel's region (join `holding_id → nuts3_id` via `combined_holding_region`, then `date`). AgERA5 computes ET0 with Penman-Monteith, exactly the reference FAO-56 assumes.

**Climate adjustment of Kc_mid (optional, FAO-56 eq. 62)**: Table 12 Kc_mid values hold for a minimum relative humidity of 45 % and a wind of 2 m/s. For a drier or windier climate:

```
Kc_mid_adj = Kc_mid + [0.04 × (u2 − 2) − 0.004 × (RHmin − 45)] × (h / 3)^0.3
```

with `u2` = `wind_speed_m_s`, `RHmin` approximated by `relative_humidity_pct` (AgERA5 gives a mean, not a minimum: the adjustment will be underestimated), `h` = `h_max_m` from the Kc file. Useful in Valladolid (ES418), negligible in Arnhem. The same adjustment applies to Kc_end if it exceeds 0.45.

## 3. The soil reservoir

**Total available water (TAW, mm)** over the rooting depth:

```
TAW = 1000 × (θ_FC − θ_WP) × Zr
```

- `θ_FC`, `θ_WP`: field capacity and wilting point (m³/m³) from `fao56_soil_water.csv`, chosen by the parcel's texture class. Classify with `sand_pct` and `clay_pct` from `synthetic_soil` (USDA triangle; the bounds in the file are indicative, a proper USDA triangle classifier is cleaner). Use `theta_fc_mid` and `theta_wp_mid`, or interpolate within the range using organic matter (`organic_matter_pct` high → towards the top of the FC range).
- `Zr`: rooting depth of the day. It grows from `zr_ini_m` at sowing to `zr_max_default_m` reached at the end of the dev stage, linearly (FAO-56 does not specify the shape; linear over ini+dev is common practice). For OLIV and HAY, Zr is constant.

**Readily available water (RAW, mm)**: the share the crop can take up without stress.

```
RAW = p × TAW
p   = p_table + 0.04 × (5 − ETc)        (FAO-56 eq. 5; bound p between 0.1 and 0.8)
```

A hot day (ETc = 8 mm) lowers p: the plant stresses earlier. The notes in the file give the sensitive windows where p should be lowered (maize and rapeseed flowering, wheat heading).

**"Surface evaporation" option**: FAO-56 proposes a dual coefficient (Kcb + Ke) separating transpiration from bare-soil evaporation after rain or irrigation. The columns `ze_m` (depth of the evaporating layer) and `rew_mm` (readily evaporable water) serve that purpose. It is more accurate in the ini stage and for frequent small irrigations, but it is extra work; the single Kc is enough for a demo.

## 4. The daily balance

State variable: `Dr(J)` = root-zone depletion in mm (0 = full reservoir, TAW = wilting point).

```
Dr(J) = Dr(J−1) − P_eff(J) − I(J) + ETc_adj(J) + DP(J)
```

- `P_eff`: effective rainfall. Simple rule: `P_eff = P − max(0, 0.2 × P − 1)` capped, or more simply 80 % of rain above 5 mm, 0 below (immediate evaporation). No data allows calibrating this rule: state it as an assumption.
- `I`: net irrigation = gross dose × system efficiency (sprinkler 0.75, pivot 0.85, drip 0.90). The dataset has no dated events: `I` comes from user input. The annual total `water_mm` in `synthetic_irrigation` is only useful to check afterwards that modelled applications are of the same order.
- `ETc_adj`: if `Dr > RAW`, the crop no longer takes up water at full rate: `Ks = (TAW − Dr) / (TAW − RAW)` and `ETc_adj = Ks × ETc` (FAO-56 eq. 84). Otherwise `Ks = 1`.
- `DP`: deep percolation. If `Dr` becomes negative (reservoir above field capacity), the excess drains: `DP = −Dr`, then `Dr = 0`. This is lost water, worth displaying — it quantifies over-irrigation.
- **Initialisation**: `Dr = 0` (full reservoir) on 1 March for spring crops and at the end of winter for autumn crops, valid in regions with wet winters. In Valladolid (ES418) or Catanzaro (ITF63), starting at `Dr = 0.3 × TAW` is more realistic; otherwise start the balance on the previous 1 October to let winter refill the reservoir.
- **Root growth**: when Zr increases, TAW increases; the water in the newly explored soil is assumed at field capacity minus the average depletion (common approximation: keep `Dr` unchanged in mm, which assumes the new layer is in the same state as the old one).

**Decision**
- Irrigate when `Dr ≥ trigger` (or when it is forecast to be reached within the N days of equipment lead time). The trigger depends on the FAO-33 period: before flowering (vegetative Ky ≤ 0.4) it is relaxed to `Ks = 0.8`, i.e. `RAW + 0.2 × (TAW − RAW)` (FAO-56: "MAD > RAW where plant moisture stress is an intentional part of soil water management"); from flowering on it is `RAW` (p already capped in the sensitive window); late season stops irrigating.
- Recommended net dose: back to a share of TAW, not to field capacity (FAO-56 only requires `I ≤ Dr`; the rest leaves room for rain): 80 % where the period's Ky ≥ 1, 75 % where Ky ≥ 0.5 or unknown, 70 % below. Net = `Dr − (1 − share) × TAW`; gross = net / efficiency, kept between the equipment's minimum and maximum dose. The 70/75/80 % bands are a team choice, not an FAO value (`engine/waterTarget.ts`).
- **Where**: rank parcels by `(RAW − Dr) / ETc` = days of autonomy before stress, prioritising crops in a sensitive window.
- **When**: first day when projected `Dr ≥ RAW`, extending `ETc` by the 5-day average and rain by 0 (or by a forecast if you train one).

## 5. Quick checks

Expected orders of magnitude to validate the engine (Loiret climate, loam soil, Zr 1.2 m):
- TAW ≈ 130 mm/m × 1.2 m ≈ 155 mm; RAW wheat ≈ 85 mm; RAW maize at flowering (p 0.45) ≈ 70 mm.
- Maize demand June-August ≈ 1.2 × ET0 ≈ 1.2 × (137 + 168 + 147) ≈ 540 mm for 2022, against 161 mm of rain: deficit ≈ 380 mm, i.e. 6 to 8 irrigation rounds of 40-50 mm. The 185 mm synthetic annual total is therefore far too low for 2022, and consistent for a wet year like 2024.
- Winter wheat: demand mostly April-June ≈ 250-300 mm, usually covered by the winter reserve except in a dry spring (2022: 37 mm in May).

## 6. Limits to state upfront

- Rain and ET0 are regional (NUTS3), not parcel-level.
- Kc, stage lengths and p are generic: a local adviser would adjust them to variety and soil. The dataset varieties (`COWT-V01`…) carry no characteristics.
- The BBCH values of the plant-protection events in the dataset are random: do not use them to recalibrate the stage. A field observation entered by the user, yes.
- No capillary rise, runoff or water table.
- The dataset yield does not respond to water; any displayed yield gain can only come from FAO-33 response functions (Ky coefficient), to be presented as theoretical.
