# PROGRESS — 5 new chat and phone tools

## Done
- 2026-10-17 Branch `feat/chat-tools` (was `analysis/chat-tools`) from main ebd60d5.
  Fixed before this plan: irrigation `source` values the DB refused (6d51ae5), tool texts used
  snake_case ids (15a5ffe). Offline suite: 220 passed. Old VAPI plan moved to `plans/`.
- 2026-10-17 Task 1: `getFieldDetails` / `getFieldJournal` (phone `get_field_details` / `get_field_journal`), `@tellia/shared/farm`, `FarmData.listOperations` + twin + fixtures, `farmInfo.service.ts`, routing lines, tests. Offline suite: 239 passed.
- 2026-10-17 Task 2: `checkProductUse` (phone `check_product_use`), `ProductCheck` in `@tellia/shared/farm`, `FarmData.listProducts` / `listProductUses` / `listJournalProductNames` + twin + E-Phy fixtures, `productCheck.service.ts`, routing lines, tests. Offline suite: 261 passed.
- 2026-10-17 Task 3: `correctIrrigation` (phone `correct_irrigation`), workflow `correct-irrigation`, `confirmIrrigation` resumes record or correction runs (status saved | cancelled | updated | deleted), `IrrigationCorrection` / `IrrigationConfirmation` in `@tellia/shared/farm`, `FarmData.updateIrrigation` + twin, service preview / update / delete, routing lines, tests. Offline suite: 284 passed.
- 2026-10-17 Task 4: `lookupFarmData` (phone `lookup_farm_data`), `FarmLookup` in `@tellia/shared/farm`, `FarmData.listCropRefs` / `listSales` / `listMarketPrices` / `listSubsidies` / `listFarmEconomics` / `listRegionalBenchmarks` + twin + fixtures for both farms, `farmLookup.service.ts`, routing lines, tests. Offline suite: 301 passed.
- 2026-10-17 Task 5: chat cards in `WidgetRenderer.tsx` for `getFieldDetails`, `getFieldJournal`, `checkProductUse`, `lookupFarmData`, `correctIrrigation` (Oui/Non card) and `confirmIrrigation` (saved / updated / deleted / cancelled), labels, `WidgetRenderer.test.tsx` (renderToString: samples checked against the shared schemas, empty and broken outputs). Web: 23 tests passed. Shared: 2 passed. API offline suite: 301 passed.
- 2026-10-17 Task 6: docs (`chat/README.md` 13-tool table + farm tool outputs + one confirmation for records and corrections + 5 workflows, `apps/api/CLAUDE.md`, `vapi/README.md` 12 phone tools) and `tests/live/chat_tools_live_test.ts` (one fresh app per test: getFieldDetails, getFieldJournal, checkProductUse, lookupFarmData, correction flow correct → Oui → confirmIrrigation → updated; `numbersIn` / `grounded` moved to `liveApp.ts`). Fixture already had the data, unchanged. Live run 1: 1 failure from a test bug (pH regex matched "phosphore"), fixed; run 2: 6 passed, 0 failed, no retry, no prompt change. `vapi:setup --dry-run`: 12 tools (7 updated, 5 created). Offline suite: 301 passed.
- 2026-10-17 Task 7: read-only review of the whole branch: 2 findings (1 medium: the season journal missed the season's manure before sowing; 1 low: a corrected irrigation date kept the old BBCH).
- 2026-10-17 Task 8: both findings confirmed in the code (and the first one read-only on the DB: field 9, op 535, 55.2 kg N/ha before sowing) and fixed with tests (7cf479f, e0eaee9). All checks pass: API check ok, offline 305 passed, live 6 passed / 0 failed / 1 ignored (1 run), web 23 passed, shared 2 passed, `vapi:setup --dry-run` 12 tools. Morning summary written.

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
- Products (Task 2): in the DB, farms 2 and 3 have no row in `product`; their synthetic products
  exist only as `operation_input.product_name` with `product_id` null. The check finds them in
  the caller's journal (`listJournalProductNames`), counts their uses by name, and answers
  "No authorisation data for this product (E-Phy covers France only)" with no rule.
- Products: for a farm outside France (`farm.country_code` not FR), E-Phy uses are shown but
  `authorised`, `applicationsLeft` and `preHarvestOk` stay null, with a warning (French rules
  are not a verdict there). An exact name beats longer names (AMISTAR, not AMISTAR GOLD).
  `preHarvestOk` is null when the uses disagree. A failed catalogue read throws (never "not found").
- Fixtures: farm 1's ADENGO spray became ELUMIS (a real catalogue product) and farm 2's
  "Herbicida A" became "Herbicide AS-HER-07 (synthetic)", like the DB.
- `makeTestMastra` (tests) uses Mastra's `InMemoryStore`, not LibSQL: see Blockers.
  `makeTestChatApp` keeps LibSQL like the real server.
- Corrections (Task 3): `confirmIrrigation` asks each confirmable workflow for the runId with
  `getWorkflowRunById`. In Mastra 1.78 the storage lookup (LibSQL and in-memory) filters on the
  workflow name, so only the owner finds the run; the owner checks run before any resume.
- Only confirmed irrigations can be corrected: a draft or planned row is a 409; a missing id,
  another farm's id or a journal row that is not an irrigation is a 404. An update must change
  something and moves the record to the crop season of its new date.
- The workflow applies a "yes" only if the record still has the values of the question
  (otherwise it fails and changes nothing). "No" changes nothing.
- Depletion moves by exactly the mm difference only without water stress between the record and
  today; the tests correct yesterday's record (the fixture's 21 June record is under stress).
- Phone result is flat: `status`, `fieldName`, `oldDate`/`oldMm`/`newDate`/`newMm` (update) or
  `date`/`mm` (delete).
- Lookup (Task 4): `synthetic` is a boolean, not always true: `regional_benchmark` is real
  regional statistics (`seed/schema.sql`), so it is `false` with its own note. The 4 other tables
  are `true`.
- Lookup: `year` filters the harvest year for `sale`. `cropCode` takes a code or a crop name in
  any language (resolved on `crop_ref`; several or no match is a 400 that lists the codes).
  `regional_benchmark` filters on the crop's `crop_group_code`. On `subsidy` and `farm_economics`
  a crop is ignored and the note says so.
- Lookup: `count` and `summary` cover every matching row, not only the rows shown. The sale
  summary adds `byCrop` and has no average price over several crops; the subsidy summary adds
  `byYear`. So the model never adds numbers. Rows are newest first.
- Lookup data: the Supabase FarmData reads `regional_benchmark` by the farm row's `nuts3_id`
  (the `Farm` type is unchanged). `listCropRefs` is cached and throws on failure (never "unknown
  crop" because of a failed read). The phone gets at most 10 rows, without codes or buyer ids.
- UI cards (Task 5): cards read the output through the shared types made loose (`Loose<T>`: every field optional or null) with runtime checks on arrays and leaf values, so a missing or wrong field never crashes the chat. No number is computed in the UI except display formatting (0-1 share shown as %). The lookup card shows at most 8 rows; the server summary covers all rows. Planned journal rows: dashed outline, no fill, "Planned" tag.
- Journal (Task 8): the default season range also keeps the rows linked to that season before
  sowing (`OperationFilter.seasonId`; Supabase `or(op_date.gte, crop_season_id.eq)`). `from` then
  gives the first day covered. Rows before sowing with no season (tillage) or another season stay
  out. An explicit `from` is a plain date range. The product usage count uses the same rule.
- Corrections (Task 8): a new date sets the row's `bbch` to null (the import stored the stage of
  the old date); an mm-only change keeps it. The memory twin has no bbch on irrigations.

## Blockers
- Needs human review, does not block the plan: the LibSQL native addon (`@libsql/client`
  0.18 under Deno 2.9.4) can segfault when the garbage collector finalizes its objects
  (macOS crash report: EXC_BAD_ACCESS in libsql `index.node`, called from a Deno napi weak
  reference callback). Adding 2 tools changed GC timing and `chat_agent_test.ts` crashed the
  whole test run 6 times out of 8; the clean tree did not. Tests now avoid LibSQL in
  `makeTestMastra`. The API server uses the same LibSQL store (`data/mastra.db`), so it may
  crash the same way. Fix options (infra decision): upgrade libsql / Deno, or another Mastra store.

## Morning summary

**Everything is built, and every check passes.** All work is on the branch `feat/chat-tools`.
Nothing is pushed: not to GitHub, not to VAPI.

### What was built
The chat now has 13 tools (was 8). The phone has 12 tools. Each new tool has a card in the chat.
- **getFieldDetails** (phone: `get_field_details`): facts about one field. Crop today, irrigation
  system, last soil analysis.
- **getFieldJournal** (phone: `get_field_journal`): what was done on a field, newest first, at most
  20 rows. The server computes the totals: N, P, K, water, sprays.
- **checkProductUse** (phone: `check_product_use`): "Can I spray this product here?". It uses
  E-Phy (the French list of allowed products). It gives times used, applications left and days
  to harvest. Farms in Spain and Italy get "no data". It never invents rules.
- **correctIrrigation** (phone: `correct_irrigation`): change or delete a saved watering. The chat
  asks Oui/Non first. The phone acts only after a clear yes, and only for known callers.
- **lookupFarmData** (phone: `lookup_farm_data`): sales, market prices, subsidies, farm accounts,
  regional averages. Only the caller's farm. The server computes the totals.

### Review fixes
The review found 2 problems. Both were real. Both are fixed, with tests.
- **The journal missed the manure before sowing.** The seed links the manure spread (10 to 30
  days before sowing) to the season. The season view now includes it. The product count too.
  Example: field 9 has 55.2 kg N/ha that was not counted. I checked the new query on the real
  DB with a read-only request.
- **Old crop stage after a date change.** When a watering moves to a new date, its stored crop
  stage (BBCH: a number for the growth stage) is now cleared. A change of mm only keeps it.

### Check results (17 Oct 2026)
- API typecheck (`deno task check`): **pass**.
- API offline tests: **305 passed**, 0 failed, 9 ignored.
- API live tests (real OpenAI model, test farm in memory, 1 run): **6 passed**, 0 failed,
  1 ignored. The ignored one is the DB test, off on purpose. All 5 new tools pass, and the
  correction flow too.
- Web: typecheck **pass**, tests **23 passed**.
- Shared package: typecheck **pass**, tests **2 passed**.
- VAPI dry run (shows changes, writes nothing): **12 phone tools**, 7 to update, 5 new.

### Not done, or not tested
- The phone tools are **not on VAPI yet**. Only the dry run ran.
- No test wrote to the real DB. So a correction was never tried on real data.
- The two review fixes were not tried in the real app, only in tests.

### Blockers (your decision)
- **LibSQL crash risk.** LibSQL is the small local database for chat memory
  (`apps/api/data/mastra.db`). Its native part can crash Deno when memory is cleaned up. Tests now
  avoid it. The real API server still uses it, so it may crash. Options: upgrade libsql or Deno,
  or use another Mastra store.

### What you need to do
1. Read the changes: `git log --oneline main..feat/chat-tools`.
2. Send the phone tools to VAPI: `cd apps/api && deno task vapi:setup` (without `--dry-run`).
3. Try the chat yourself. A correction **writes to the shared DB**: your choice to try it.
4. Decide on the LibSQL blocker.
5. When you are happy, push: `git push -u origin feat/chat-tools`.
