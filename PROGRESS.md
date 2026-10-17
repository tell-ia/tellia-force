# PROGRESS — 5 new chat and phone tools

## Done
- 2026-10-17 Branch `feat/chat-tools` (was `analysis/chat-tools`) from main ebd60d5.
  Fixed before this plan: irrigation `source` values the DB refused (6d51ae5), tool texts used
  snake_case ids (15a5ffe). Offline suite: 220 passed. Old VAPI plan moved to `plans/`.
- 2026-10-17 Task 1: `getFieldDetails` / `getFieldJournal` (phone `get_field_details` / `get_field_journal`), `@tellia/shared/farm`, `FarmData.listOperations` + twin + fixtures, `farmInfo.service.ts`, routing lines, tests. Offline suite: 239 passed.

## In progress

## Key decisions
- One generic read tool (`lookupFarmData`) for the synthetic business tables, specific tools for
  advice-grade data (journal, products, soil, corrections).
- `confirmIrrigation` confirms both new records and corrections (one Oui/Non card in the UI).
- Phone tools are pushed to VAPI only by Vincent (`deno task vapi:setup`); agents use `--dry-run`.
- Journal (Task 1): `planned` = status planned or date after today. Totals count done rows only
  (`totals.planned` counts the others). kg/ha and mm sums are null when the rows cover several
  fields (they cannot be added). With one date bound, the other comes from the default range;
  an upside-down range is a 400. The phone gets 10 entries, products as short strings.
- Field details and journal live in `irrigation/farmInfo.service.ts`, merged into
  `IrrigationService` (one service per farm scope, existing wraps keep working).
- `makeTestMastra` (tests) uses Mastra's `InMemoryStore`, not LibSQL: see Blockers.
  `makeTestChatApp` keeps LibSQL like the real server.

## Blockers
- Needs human review, does not block the plan: the LibSQL native addon (`@libsql/client`
  0.18 under Deno 2.9.4) can segfault when the garbage collector finalizes its objects
  (macOS crash report: EXC_BAD_ACCESS in libsql `index.node`, called from a Deno napi weak
  reference callback). Adding 2 tools changed GC timing and `chat_agent_test.ts` crashed the
  whole test run 6 times out of 8; the clean tree did not. Tests now avoid LibSQL in
  `makeTestMastra`. The API server uses the same LibSQL store (`data/mastra.db`), so it may
  crash the same way. Fix options (infra decision): upgrade libsql / Deno, or another Mastra store.

## Morning summary
