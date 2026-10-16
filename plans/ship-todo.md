# Ship TODO

Running list of what's left to wire for the demo.

## VAPI — phone per persona (Vincent's hack)

Only one VAPI number for the team. Instead of a persistent per-user flag, tie the
caller's phone to the selected company at selection time:

- When the user **selects a company (persona)**, they also pick **their own phone
  number** from a small dropdown (2–3 presets: Marceau, Axel, Imad, …).
- Selecting the company **saves that phone number on the company's user/member**,
  so a call/SMS on the single VAPI number resolves to the right person +
  company. No flag to persist across the app.

To build:
- **Front**: phone dropdown in the persona bottom sheet (presets); on farm select,
  call an endpoint to set the member's phone.
- **Backend** (Vincent/Imad): endpoint to set `member.phone` for the farm's
  main-contact (e.g. `PATCH /…/member/:id { phone }`), used by the VAPI routing.

## Other

- **Report localization** (Vincent): serve crop/stage names by `member.language`
  (`crop_ref.name_<lang>`, `crop_stage.label_<lang>`). DB already multilingual →
  the front renders as-is, no translation. (Currently crops = FR, stages = EN.)
- **Parcel live — remaining rich sections**: `cropStage` (from report `stage`) and
  `soil` composition (join `soil_analysis`) + `nextDays`. series + season already
  live.
- **In-app voice call** (optional): VAPI Web SDK with `VITE_VAPI_PUBLIC_KEY` +
  assistant id, or a simple `tel:` to `VITE_VAPI_PHONE_NUMBER`.
