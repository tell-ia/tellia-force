# PLAN — 5 new tools for the AI chat and the phone (branch `feat/chat-tools`)

Goal: the farmer can ask about more than irrigation. Today the chat has 8 tools, all about
irrigation. We add 5 tools (13 in total), in the web chat (Mastra) and on the phone (VAPI),
with a UI card for each.

Approved by Vincent on 2026-10-17: all 5 tools, chat + phone, backend + UI cards, live tests allowed.

## Where to work

- Worktree: `/Users/vincent/Downloads/hack/tellia-force-2`, branch `feat/chat-tools`.
  The shell resets its folder after each command: start every command with
  `cd /Users/vincent/Downloads/hack/tellia-force-2/<sub folder> && ...`.
- Never touch `/Users/vincent/Downloads/hack/tellia-force` (another branch is open there).

## Safety rules (repeat to every agent that runs tests)

- **Never write to the shared Supabase DB.** No insert, update, delete or RPC from a script, a test
  or curl. Read-only GET requests are fine (key `SUPABASE_SECRET_KEY` in `apps/api/.env`,
  header `apikey`; never print the key). Never run `seed --reset` or `migrate.py`.
- Tests use in-memory farms only (`tests/helpers/testApp.ts`, `tests/fixtures/`).
  Offline suite: `cd apps/api && env -u RUN_DB_TESTS -u RUN_LIVE_TESTS deno task test`.
  Never set `RUN_DB_TESTS=1`.
- Live tests (real OpenAI model, in-memory farm, temp LibSQL, no DB writes) are allowed:
  `cd apps/api && env -u RUN_DB_TESTS deno task test:live`. At most 3 runs per agent.
- VAPI: only `deno task vapi:setup --dry-run`. Never run it without `--dry-run`. Never start the tunnel.
- Never push. Never start a long-running server and leave it running.
- The local Mongo dev DB (localhost:27017, db `agri-backend`, another project) must never be
  touched. If you are not sure which database a command hits, stop and record a blocker.

## Rules for every task

1. Read `PLAN.md` and `PROGRESS.md` first.
2. Contracts live in `@tellia/shared` (root `CLAUDE.md`). New tool output schemas go in a new file
   `packages/shared/src/farm.ts`, exported as `@tellia/shared/farm`: add it to
   `packages/shared/package.json` exports, `packages/shared/src/index.ts` and the import map in
   `apps/api/deno.json`. `index.ts` re-exports `db.ts`, `irrigation.ts` and `app.ts` too: pick names
   that do not collide (`FieldDetailsSchema`, not `FieldSchema`). Task 1 creates the file.
3. Farm data goes through `FarmData` (`apps/api/src/modules/irrigation/data/farmData.ts`):
   add methods there, in `supabaseFarmData.ts` (filter every farm table on `farm_id`; reference
   tables `product`, `product_use`, `market_price`, `crop_ref` are global; `regional_benchmark` is
   filtered by the farm's `nuts3_id`) and in the in-memory twin `memoryFarmData.ts` + fixtures.
   Columns: `seed/schema.sql` and `packages/shared/src/db.ts`. Map snake_case to camelCase at the
   boundary.
4. Use cases go in the irrigation service (`irrigation.service.ts`), or a new service file next to
   it if it gets too big. **Every number and total is computed by the server**, never by the LLM.
5. Chat tool: `apps/api/src/modules/chat/tools.ts`. Key = camelCase name below (UI contract),
   `id` = snake_case. Tool texts name other tools by key (a test checks it). The member and farm
   come only from the request context. Keep results small (lists capped, see each task).
6. Phone tool: `apps/api/src/modules/vapi/vapi.tools.ts`, snake_case name, short flat result (the
   voice reads all of it). Writes only for known callers (`known`), like `record_irrigation`.
7. Prompts: allowed changes are one routing line per new tool in `RULES`
   (`chat/advisor.agent.ts`) and in `SYSTEM_PROMPT` (`apps/api/scripts/vapiSetup.ts`), and widening
   the phone line "Only talk about irrigation..." to the new topics. Any other prompt or model
   change: record a blocker.
8. Tests: offline tests for the service, the chat tool and the phone tool, including farm
   scoping (farm 2 never sees farm 1's data). Run `deno task check` and the offline suite.
9. Don't rename the 8 existing tool keys.
10. When done: check the task box here, add one line to `PROGRESS.md`, make one focused commit
    ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Keep the tree clean.
11. Escalate, don't guess: security, credentials, DB schema change or prompt tuning → write it
    under "Blockers" in `PROGRESS.md` and skip that part.

## The 5 tools

### Tool A — `getFieldDetails` / phone `get_field_details` (read)
"Tell me about La Vallée." Input `{ fieldId }`. Output `FieldDetails`:
- field: id, name, areaHa, tenure, irrigable;
- crop today (or null): code, name (member language), variety, earlinessGroup, sowingDate,
  harvestDate, status, previous crop name;
- irrigation system (or null): name, type, efficiency, doseMinMm, doseMaxMm, roundDays;
- latest soil analysis (or null): sampledOn, USDA texture class (engine `usdaTextureClass`),
  sand/silt/clay %, organic matter %, pH, N g/kg, P, K, S, Ca, Mg, Zn, B mg/kg, CEC, bulk density,
  lime requirement.

### Tool B — `getFieldJournal` / phone `get_field_journal` (read)
"What did I do on La Vallée?", "When did I last spray the wheat?", "How much nitrogen this season?"
Input `{ fieldId?, type?: sowing|fertilisation|spraying|irrigation|harvest|tillage|observation|other,
from?, to? }`. Default range: the field's current crop season (sowing to harvest); with no field,
the last 365 days up to today + 30 days.
- Table `operation` (+ `operation_input` for products). Drafts and cancelled rows are left out.
  Rows after today are `planned`: flag them `planned: true`.
- Output: `{ fieldId|null, from, to, entries, totals, truncated }`. Entries newest first, at most 20:
  date, type, fieldId, fieldName, status, planned, bbch, and the type's values (fertiliser type,
  N/P2O5/K2O kg/ha, water mm, variety, seed rate, yield, moisture, protein, method, notes) and
  products `[{ productName, dose, doseUnit, target }]`.
- `totals` over the whole range (not only the 20 shown): count per type, N, P2O5, K2O kg/ha
  summed over fertilisations, irrigation mm, number of sprays.

### Tool C — `checkProductUse` / phone `check_product_use` (read)
"Can I still spray Amistar on La Vallée?" Input `{ product, fieldId, date? }` (date default today).
- Find the product by name (accent and case insensitive, like `resolveField`) or AMM number.
  Several matches → return them and no verdict. No match → say so.
- Uses for the field's crop today (`product_use` on `crop_code`): target, maxDose, doseUnit,
  maxApplications, preHarvestIntervalDays, bbchMin, bbchMax, bufferZoneWaterM, conditions.
- From the journal of the current season: times used (`operation_input.product_id`), last date,
  doses. `applicationsLeft` = maxApplications − times used, when there is one use row.
- `daysToHarvest` (expected harvest − date) and `preHarvestOk` (date + interval ≤ harvest).
- `authorised`: the crop has at least one use. Not authorised → warning.
- E-Phy is France only: farms 2 (es) and 3 (it) have synthetic products with no uses. Then say
  "no authorisation data for this product (E-Phy covers France only)". Never invent rules.
- Crop stage (BBCH) is not checked automatically: give bbchMin/bbchMax and say so in a warning.

### Tool D — `correctIrrigation` / phone `correct_irrigation` (write, with yes/no)
"It was 25 mm, not 30, yesterday on La Vallée", "Delete the watering of 4 July."
- Chat: input `{ operationId, action: "update"|"delete", date?, mm? }`. The model finds the
  `operationId` with `getIrrigationHistory`. New Mastra workflow `correct-irrigation`
  (copy `record-irrigation`): validate (operation of the caller's farm, an irrigation,
  `confirmed`; new date/mm pass the same checks as recording; the date keeps a crop season)
  → suspend with a summary ("Change 4 July on La Vallée: 30 mm → 25 mm?") → resume
  `{ confirmed }` → update or delete, or change nothing. Only the member who started it may answer.
- Output `{ runId, status: "awaiting_confirmation", summary, fieldName, action, before: {date, mm},
  after: {date, mm} | null }`.
- **One confirm tool for both flows**: `confirmIrrigation` resumes `record-irrigation` or
  `correct-irrigation` (find which one owns the runId; keep the owner checks before resuming).
  Its status enum grows: `saved | cancelled | updated | deleted`. Update its description.
- Data: `FarmData.updateIrrigation(operationId, { date, mm, seasonId })` (also sets `updated_at`);
  `deleteIrrigation` exists. Service: preview, update, delete.
- Phone: direct, like `record_irrigation`: only after the farmer clearly said yes; refused for
  unknown callers.

### Tool E — `lookupFarmData` / phone `lookup_farm_data` (read, generic)
"How much wheat did I sell in 2024?", "Wheat price trend?", "My subsidies last year?"
Input `{ table: "sale"|"market_price"|"subsidy"|"farm_economics"|"regional_benchmark",
year?, cropCode?, limit? }` (limit ≤ 50, default 20).
- Fixed list of tables. `sale`, `subsidy`, `farm_economics`: caller's farm only. `market_price`:
  global, by crop. `regional_benchmark`: the farm's `nuts3_id`.
- Output `{ table, synthetic: true, note, rows (camelCase), count, truncated, summary }`.
  `note` says this is synthetic demo data (prices are a reference ±2.3 %, accounts are flat).
  `market_price` rows after the current month get `forecast: true`.
- `summary` computed by the server: sale → total volume t, total revenue €, average price €/t
  (weighted); subsidy → total €; others → null.

## Tasks

- [x] 1. Tools A + B (`getFieldDetails`, `getFieldJournal`): create `@tellia/shared/farm`, data
      layer + twin + fixtures, service, chat tools, phone tools, routing lines, offline tests.
- [ ] 2. Tool C (`checkProductUse`), same layers and tests. Fixtures: a few products and uses for
      farm 1's crops, synthetic ones for farm 2.
- [ ] 3. Tool D (`correctIrrigation`): workflow, shared confirm tool, data layer, phone tool,
      routing lines, offline tests (update, delete, decline, foreign member refused, other farm's
      operation refused, unknown phone caller refused).
- [ ] 4. Tool E (`lookupFarmData`), same layers and tests (farm scoping, forecast flag, summary).
- [ ] 5. UI cards in `apps/web/src/features/chat/WidgetRenderer.tsx`: a card per new key, labels,
      `correctIrrigation` reuses the Oui/Non confirmation card, `confirmIrrigation` badge shows
      updated / deleted. Cards read the shared types. Add a small vitest render test
      (`react-dom/server`) per card: sample output and empty output must not crash.
      Checks: `cd apps/web && pnpm check-types && pnpm test`, `cd packages/shared && pnpm check-types && pnpm test`.
- [ ] 6. Docs + live tests: `chat/README.md` tool table, `apps/api/CLAUDE.md` (13 tools),
      `vapi/README.md`. Live tests: one turn per new tool (the right tool is called; numbers in the
      reply come from the tool), plus a correction flow (correct → "Oui" → confirmIrrigation →
      updated). Run them. `deno task vapi:setup --dry-run` must list 12 phone tools.
- [ ] 7. Review of the whole branch (read only).
- [ ] 8. Fix the confirmed review findings, run every check, write the morning summary in `PROGRESS.md`.
