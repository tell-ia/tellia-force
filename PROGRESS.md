# PROGRESS — 5 new chat and phone tools

## Done
- 2026-10-17 Branch `feat/chat-tools` (was `analysis/chat-tools`) from main ebd60d5.
  Fixed before this plan: irrigation `source` values the DB refused (6d51ae5), tool texts used
  snake_case ids (15a5ffe). Offline suite: 220 passed. Old VAPI plan moved to `plans/`.

## In progress

## Key decisions
- One generic read tool (`lookupFarmData`) for the synthetic business tables, specific tools for
  advice-grade data (journal, products, soil, corrections).
- `confirmIrrigation` confirms both new records and corrections (one Oui/Non card in the UI).
- Phone tools are pushed to VAPI only by Vincent (`deno task vapi:setup`); agents use `--dry-run`.

## Blockers

## Morning summary
