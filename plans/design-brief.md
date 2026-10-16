# Tellia — Mobile demo app · Design brief

Paste this into Claude Design (claude.ai). Reference mockup (content/structure only, NOT the visual target — go more polished): https://claude.ai/artifact/JqHig7fW4aCHbECbKphDo5?sk=z4hMwxaBk2R65LdKim7pRw
Invoke the `tellia-brand` skill first for colors / typography / logo.

## Product
Tellia — the farm's AI irrigation advisor. Every morning it tells a farmer **which field to water, when, how many mm, and why**, from a transparent FAO-56 soil water balance (real weather + crop stage + soil). The farmer logs watering by voice; records stay current without typing.

## Platform & constraints
- Mobile-first, Android (Capacitor). Phone frame 390×844.
- Language: **English**.
- No auth. Persona switch = selector of 2-3 fake farms, tap reswitches the whole view.
- Numbers come from a real API (`get_parcel_report`); UI must render data-viz, not fake it.

## Visual direction (push beyond the mockup)
The reference is flat/earthy/basic. Aim higher: confident hierarchy, the daily recommendation as the hero, **data-viz that looks crafted** (soil-water reserve, balance timeline), calm agricultural palette per Tellia brand, generous spacing, one accent for "action needed". Mobile-native feel (big tap targets, bottom sheet for persona switch). Light + dark.

## Screens (6)
1. **Persona selector** — top bar (farm name + avatar) → bottom sheet listing 2-3 farms. Switches parcels, chat, numbers.
2. **Home / "Today"** — the daily brief materialized: list of parcels with today's action, urgency badges (color by water-stress threshold). e.g. "The Valley — Irrigate by Fri · 40 mm", "The Well — OK 3 more days".
3. **Chat (in-app, WhatsApp-style, EN)** — morning brief ("3 things today"), farmer voice note bubble ("Should I water The Valley?"), assistant reply + a card link "See The Valley details", action logged ("Noted: 40 mm on The Valley, Thu").
4. **Parcel detail** — the hero screen. Recommendation card ("Apply 40 mm · Irrigate by Fri 15"), soil-water reserve bar (today 97 / full 144 mm, comfort threshold 79), 10-days-past / 5-days-ahead chart (rain, irrigation, consumption, reserve line + forecast), crop-stage timeline (flowering), soil card, next-days table, season balance tiles.
5. **Log irrigation (voice/form)** → after logging, **the reserve + chart visibly update** = the product "wow" (farmer-entered dated data drives the model).
6. *(optional)* **Admin / demo trigger** — a control to fire the morning brief on stage.

## Demo data (hero parcel — keep these numbers)
- Farm: Oakfield Farm — Loiret, FR (real farm FARM-02580). Campaign: July 2022 (drought). Date in demo: Wed 13 July 2022.
- Parcel "The Valley": grain maize, 5.96 ha, sown 3 May.
- Recommendation: apply 40 mm, irrigate by Fri 15 (≈50 mm gross with reel gun); 2nd pass 30-35 mm ~19th.
- Soil-water reserve: 97 of 144 mm today (67% of usable), comfort threshold 79 mm, reached Fri without water.
- Crop: flowering since 12 July (850 °C·d); GDD 871 base 6; consumption 6.9 mm/day (8.4 tomorrow).
- Soil: silty sand (64% sand · 7% clay · 5% OM), usable reserve 144 mm over 1.2 m roots.
- Next days (reserve % usable, threshold 55%): Thu14 31° 61% · Fri15 27° 56%→84% if watered · Sat16 28° 50% · Sun17 31° 45% · Mon18 36° 38%. First rain Wed 20, 6 mm.
- Season balance: rain 149 mm · irrigated 35 mm · consumed 209 mm · drained 22 mm · 0 stress days · 72 crop days.

## Personas
- Oakfield Farm — Loiret (hero, maize drought).
- A 2nd farm (backup real FARM-03527, 8 parcels, 47 ha) — different region/crop for contrast.
