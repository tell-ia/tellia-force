# Chat contract — web ↔ advisor backend

How the mobile app (`apps/web`) talks to the chat backend (`apps/api/src/modules/chat`).
The app follows `apps/api/src/modules/chat/README.md`; this notes what the **UI
expects** and the few things to confirm. Chat is **live** (never mocked).

## Transport

- `GET /chat/history` → `{ data: { threadId, messages } }`, `messages` = AI SDK
  **v7** UI messages. The app loads this first and seeds `useChat` with them.
- `POST /chat` → AI SDK v7 UI message stream. The app uses `@ai-sdk/react`
  `useChat` + `ai` `DefaultChatTransport` (`ai@7`, `@ai-sdk/react@4`).
- Header **`x-member-id`** on both (set by the persona switch). Sent dynamically,
  so switching farm re-scopes the conversation. `Content-Type: application/json`.
  Both headers are already in the API's CORS allow-list.
- The app sends **only the newest** user message; the server keeps the thread.

## Widgets = tool parts (the UI contract)

The app renders each tool part as a card (`src/features/chat/WidgetRenderer.tsx`).
Part type is `tool-<key>`; card by `state`:

- `input-streaming` / `input-available` → skeleton
- `output-available` → card (reads `output`)
- `output-error` → error card

Keys handled (your README's eight) — output shapes come from
`@tellia/shared/irrigation`:

| key                   | card                         | needs in `output`                    |
| --------------------- | ---------------------------- | ------------------------------------ |
| `getFieldReport`      | decision + mm + reason       | `fieldId`, `fieldName`, `decision`, `irrigateMm`, `reason` |
| `getFarmAdvice`       | ranked field rows            | `reports[]` each with `fieldId`, `fieldName`, `decision`, `irrigateMm` |
| `recordIrrigation`    | confirm card (Oui / Non)     | `summary` (or `fieldName`+`date`+`mm`) |
| `confirmIrrigation`   | saved / cancelled badge      | `status: "saved" \| "cancelled"`     |
| `resolveField`        | field chips                  | `matches[]` with `fieldId`, `name`   |
| `getWeather`          | day strip                    | `days[]` with `date`, `rain`         |
| `simulateScenario`    | before → after               | `comparison` with `mmBefore`, `mmAfter`, `summary` |
| `getIrrigationHistory`| record list                  | `records[]` with `date`, `mm`        |

Any **unknown key or missing field** renders a safe fallback card — the chat never
crashes on a part it doesn't know.

### Confirmation flow

`tool-recordIrrigation` (`status: "awaiting_confirmation"`) shows **Oui / Non**.
Tapping sends the user message `Oui` / `Non` through `useChat`; the assistant then
calls `confirmIrrigation`. Matches your README.

## Deep links

Cards link into the app with `telliaforce://parcel/<fieldId>#balance`, which the
app resolves to the in-app route `#/parcel/<fieldId>#balance` (scrolls to the
water-balance section). So: **put the numeric `fieldId` in every parcel-related
tool output** (getFieldReport / getFarmAdvice already do).

## To confirm / decide (Imad)

1. `GET /chat/history` envelope is exactly `{ data: { threadId, messages } }` with
   v7 UI messages? (The app passes `messages` straight into `useChat`.)
2. Tool keys stay exactly as above (renaming breaks the cards).
3. Balance series for the **parcel screen** (`DayBalance[]`) — separate from chat:
   expose via a baseline `simulate` (empty events) or a `GET
   /irrigation/fields/:id/balance`? Needed to drive the reserve chart from live.
