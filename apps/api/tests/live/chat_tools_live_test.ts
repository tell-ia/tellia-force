// Live tests for the farm tools beyond irrigation advice: REAL LLM, in-memory farm (no Supabase
// writes), temp LibSQL store. Run with `deno task test:live`. Skipped unless RUN_LIVE_TESTS=1.
// Each test gets its own app (fresh farm and empty chat memory), so one answer never leaks
// into the next question. Assertions are on tool calls and numbers, never on wording.
// Fixture facts used here (tests/fixtures/farm.ts, today 2026-07-05): La Vallée (field 10,
// maize MAIZ-V03, harvest 17 Oct), soil pH 6.4, N 110 kg/ha this season, DECIS PROTECH never
// used (3 applications, 30 days before harvest), 2024 wheat sales 100 t for 22 400 EUR, and a
// confirmed 30 mm irrigation on 21 June (operation 1).

import { assert, assertEquals } from "@std/assert";
import {
  type ChatTurn,
  chatTurn,
  grounded,
  LIVE,
  makeLiveApp,
  numbersIn,
  turnWithRetry,
} from "../helpers/liveApp.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };
const called = (t: ChatTurn, name: string) => t.toolCalls.filter((c) => c.name === name);
const tools = (t: ChatTurn) => JSON.stringify(t.toolCalls.map((c) => [c.name, c.input]));

/** Numbers the reply may use: every tool output number, plus 0-1 shares written as %. */
function allowedNumbers(t: ChatTurn): number[] {
  const all = numbersIn(t.toolCalls.map((c) => c.output));
  return [...all, ...all.filter((n) => n > 0 && n <= 1).map((n) => n * 100)];
}

/** Every number written before one of `units` must come from the tools. */
function assertGrounded(t: ChatTurn, units: string[]) {
  const allowed = allowedNumbers(t);
  for (const unit of units) {
    const { found, bad } = grounded(t.text, unit, allowed);
    assertEquals(bad, [], `ungrounded numbers before /${unit}/: ${bad} (found ${found})`);
  }
}

/** The number appears in the reply as a whole number, not inside another one. */
const mentions = (text: string, n: number) => new RegExp(`(?<![\\d.,])${n}(?![\\d])`).test(text);

Deno.test({
  name: "live: getFieldDetails answers about a field's crop and soil",
  ignore: !LIVE,
  ...opts,
  async fn() {
    const { app } = await makeLiveApp();
    const ok = (x: ChatTurn) => called(x, "getFieldDetails").some((c) => c.input?.fieldId === 10);
    const turn = await turnWithRetry(
      "field-details",
      () => chatTurn(app, "Parle-moi de La Vallée : quelle variété, et que dit l'analyse de sol ?"),
      ok,
    );
    console.log(`[live] field details reply: ${turn.text}`);
    assert(ok(turn), `getFieldDetails(10) not called: ${tools(turn)}`);
    const d = called(turn, "getFieldDetails").find((c) => c.input?.fieldId === 10)!.output;
    assertEquals([d?.crop?.variety, d?.soil?.ph], ["MAIZ-V03", 6.4]);
    assert(turn.text.trim().length > 0, "empty reply");
    assertGrounded(turn, ["%", "ha\\b", "m?g\\s*/\\s*kg", "cmol"]);
    // Case-sensitive "pH" as a word: "phosphore" must not match.
    const ph = [...turn.text.matchAll(/\bpH\b\D{0,15}?(\d+(?:[.,]\d+)?)/g)].map((m) =>
      Number(m[1].replace(",", "."))
    );
    assertEquals(ph.filter((n) => Math.abs(n - 6.4) > 0.05), [], `pH not 6.4: ${ph}`);
  },
});

Deno.test({
  name: "live: getFieldJournal gives the season's nitrogen from its totals",
  ignore: !LIVE,
  ...opts,
  async fn() {
    const { app } = await makeLiveApp();
    const ok = (x: ChatTurn) =>
      called(x, "getFieldJournal").some((c) =>
        c.input?.fieldId === 10 && c.output?.totals?.nKgHa === 110
      );
    const turn = await turnWithRetry(
      "journal",
      () => chatTurn(app, "Combien d'azote ai-je apporté sur La Vallée cette saison ?"),
      ok,
    );
    console.log(`[live] journal reply: ${turn.text}`);
    assert(ok(turn), `getFieldJournal(10) with N 110 not called: ${tools(turn)}`);
    assert(mentions(turn.text, 110), `reply lacks the 110 kg/ha total: ${turn.text}`);
    assertGrounded(turn, ["kg"]);
  },
});

Deno.test({
  name: "live: checkProductUse gives the verdict for a product on a field",
  ignore: !LIVE,
  ...opts,
  async fn() {
    const { app } = await makeLiveApp();
    const ok = (x: ChatTurn) =>
      called(x, "checkProductUse").some((c) =>
        c.input?.fieldId === 10 && /decis/i.test(String(c.input?.product)) &&
        c.output?.status === "found"
      );
    const turn = await turnWithRetry(
      "product-check",
      () => chatTurn(app, "Est-ce que je peux encore passer du Decis Protech sur La Vallée ?"),
      ok,
    );
    console.log(`[live] product check reply: ${turn.text}`);
    assert(ok(turn), `checkProductUse(DECIS, 10) not found: ${tools(turn)}`);
    const c = called(turn, "checkProductUse").find((x) => x.output?.status === "found")!.output;
    assertEquals(
      [c.authorised, c.applicationsLeft, c.daysToHarvest, c.preHarvestOk],
      [true, 3, 104, true],
    );
    assert(turn.text.trim().length > 0, "empty reply");
    assertGrounded(turn, ["jours?", "L\\s*/\\s*ha", "m\\b", "applications?"]);
  },
});

Deno.test({
  name: "live: lookupFarmData gives the sales total from its summary",
  ignore: !LIVE,
  ...opts,
  async fn() {
    const { app } = await makeLiveApp();
    const wheat2024 = (o: unknown) => {
      // deno-lint-ignore no-explicit-any
      const s = (o as any)?.summary;
      // deno-lint-ignore no-explicit-any
      return (s?.byCrop ?? []).some((b: any) => b.cropCode === "COWT" && b.volumeT === 100);
    };
    const ok = (x: ChatTurn) =>
      called(x, "lookupFarmData").some((c) => c.input?.table === "sale" && wheat2024(c.output));
    const turn = await turnWithRetry(
      "lookup",
      () => chatTurn(app, "Combien de blé ai-je vendu sur la récolte 2024, et pour combien ?"),
      ok,
    );
    console.log(`[live] lookup reply: ${turn.text}`);
    assert(ok(turn), `lookupFarmData(sale) with 2024 wheat not called: ${tools(turn)}`);
    assert(mentions(turn.text, 100), `reply lacks the 100 t: ${turn.text}`);
    assertGrounded(turn, ["€", "eur\\b", "euros?", "t\\b", "tonnes?"]);
  },
});

Deno.test({
  name: "live: correction flow (correctIrrigation -> Oui -> confirmIrrigation -> updated)",
  ignore: !LIVE,
  ...opts,
  async fn() {
    const { app, data } = await makeLiveApp();
    const before = await data.getIrrigation(1);
    assertEquals([before?.date, before?.mm, before?.status], ["2026-06-21", 30, "confirmed"]);

    const isCorrection = (x: ChatTurn) =>
      called(x, "correctIrrigation").some((c) =>
        c.input?.operationId === 1 && c.input?.action === "update" && c.input?.mm === 25 &&
        c.output?.status === "awaiting_confirmation"
      );
    const q =
      "Je me suis trompé pour l'arrosage du 21 juin sur La Vallée : c'était 25 mm, pas 30. Tu peux le corriger ?";
    const t1 = await turnWithRetry("correct", () => chatTurn(app, q), isCorrection);
    console.log(`[live] correction turn-1 reply: ${t1.text}`);
    assert(isCorrection(t1), `correctIrrigation(1, update, 25) not called: ${tools(t1)}`);
    assertEquals(called(t1, "confirmIrrigation").length, 0, "confirmIrrigation called in turn 1");
    const corr = called(t1, "correctIrrigation").find((c) => c.output?.runId)!.output;
    assertEquals([corr.before, corr.after], [
      { date: "2026-06-21", mm: 30 },
      { date: "2026-06-21", mm: 25 },
    ]);
    assertEquals((await data.getIrrigation(1))?.mm, 30, "changed before the farmer said yes");
    assertGrounded(t1, ["mm"]);

    const t2 = await turnWithRetry(
      "confirm-correction",
      () => chatTurn(app, "Oui"),
      (x) => called(x, "confirmIrrigation").length > 0,
    );
    console.log(`[live] correction turn-2 reply: ${t2.text}`);
    const conf = called(t2, "confirmIrrigation");
    assert(conf.length > 0, `confirmIrrigation not called on yes: ${tools(t2)}`);
    assertEquals([conf[0].input?.runId, conf[0].input?.confirmed], [corr.runId, true]);
    assertEquals([conf[0].output?.status, conf[0].output?.record?.mm], ["updated", 25]);
    const after = await data.getIrrigation(1);
    assertEquals([after?.date, after?.mm, after?.status], ["2026-06-21", 25, "confirmed"]);
    const ops = await data.listIrrigations(10, { includeDrafts: true });
    assertEquals(ops.filter((o) => o.mm === 30).length, 0, "the 30 mm record is still there");
  },
});
