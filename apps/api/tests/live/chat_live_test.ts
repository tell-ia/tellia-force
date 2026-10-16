// Live end-to-end tests: REAL LLM, in-memory farm (no Supabase writes), temp LibSQL store.
// Run with `deno task test:live`. Skipped unless RUN_LIVE_TESTS=1.
// Assertions are on tool calls and numbers, never on wording.

import { assert, assertEquals } from "@std/assert";
import {
  type ChatTurn,
  chatTurn,
  DB_TESTS,
  LIVE,
  makeLiveApp,
  turnWithRetry,
} from "../helpers/liveApp.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };
const HEADERS = { "x-member-id": "1" };
const TODAY = "2026-07-05";
const YESTERDAY = "2026-07-04";
const called = (t: ChatTurn, name: string) => t.toolCalls.filter((c) => c.name === name);

/** Every finite number anywhere in the tool outputs (recursive; null/undefined skipped). */
function numbersIn(v: unknown, acc: number[] = []): number[] {
  if (typeof v === "number") {
    if (Number.isFinite(v)) acc.push(v);
  } else if (Array.isArray(v)) {
    for (const x of v) numbersIn(x, acc);
  } else if (v !== null && v !== undefined && typeof v === "object") {
    for (const x of Object.values(v)) numbersIn(x, acc);
  }
  return acc;
}
const toolNumbers = (t: ChatTurn) => numbersIn(t.toolCalls.map((c) => c.output));

/** Every "N mm" in the text must equal a grounded number from the tool output (±0.5). */
function mmGrounded(text: string, allowed: number[]) {
  const found = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*mm/gi)].map((m) =>
    Number(m[1].replace(",", "."))
  );
  const bad = found.filter((n) => !allowed.some((a) => Math.abs(a - n) <= 0.5));
  return { found, bad };
}

Deno.test({
  name: "live: chat flow on the real model (advice, scenario, confirmation, memory)",
  ignore: !LIVE,
  ...opts,
  async fn(t) {
    const { app, data, service } = await makeLiveApp();
    const timings: Record<string, unknown> = {};

    await t.step("1. advice is grounded in tool numbers", async () => {
      const turn = await turnWithRetry(
        "advice",
        () => chatTurn(app, "Quel champ dois-je arroser aujourd'hui ?"),
        (x) => called(x, "getFarmAdvice").length > 0,
      );
      const adv = called(turn, "getFarmAdvice");
      assert(adv.length > 0, "getFarmAdvice not called");
      assert(turn.text.trim().length > 0, "empty reply");
      assert(turn.text.includes("La Vallée"), `reply lacks La Vallée: ${turn.text}`);
      assert((adv[0].output?.reports ?? []).length > 0, "no reports in tool output");
      const allowed = toolNumbers(turn);
      const { found, bad } = mmGrounded(turn.text, allowed);
      assertEquals(bad, [], `ungrounded mm ${bad} (found ${found}, allowed ${allowed})`);
      timings.advice = {
        msFirstText: Math.round(turn.msFirstText),
        msTotal: Math.round(turn.msTotal),
      };
      console.log(`[live] advice reply: ${turn.text}`);
    });

    await t.step("2. scenario calls simulateScenario with a drought on field 10", async () => {
      const q = "Et si une sécheresse de 5 jours commence aujourd'hui sur La Vallée ?";
      const ok = (x: ChatTurn) =>
        called(x, "simulateScenario").some((c) =>
          c.input?.fieldId === 10 &&
          // deno-lint-ignore no-explicit-any
          (c.input?.events ?? []).some((e: any) => e.type === "drought")
        );
      const turn = await turnWithRetry("scenario", () => chatTurn(app, q), ok);
      assert(
        ok(turn),
        `simulateScenario(10, drought) not called: ${
          JSON.stringify(turn.toolCalls.map((c) => [c.name, c.input]))
        }`,
      );
      assert(turn.text.trim().length > 0, "empty reply");
      const sim = called(turn, "simulateScenario").map((c) => c.output);
      const allowed = numbersIn(sim);
      const { found, bad } = mmGrounded(turn.text, allowed);
      assertEquals(bad, [], `ungrounded mm ${bad} (found ${found})`);
      console.log(`[live] scenario reply: ${turn.text}`);
    });

    await t.step("3. two-turn confirmation records only after a yes", async () => {
      const q = "J'ai arrosé La Vallée hier, 25 mm";
      const before = (await service.getFieldReport(10, TODAY)).depletionMm;
      const isRecord = (x: ChatTurn) =>
        called(x, "recordIrrigation").some((c) =>
          c.input?.fieldId === 10 && c.input?.mm === 25 && c.input?.date === YESTERDAY
        );
      // Retry must start clean: drop any draft the first attempt left in the twin.
      const dropDrafts = async () => {
        for (
          const o of (await data.listIrrigations(10, { includeDrafts: true }))
            .filter((o) => o.status === "draft")
        ) await data.deleteIrrigation(o.operationId);
      };
      const t1 = await turnWithRetry("record", () => chatTurn(app, q), isRecord, dropDrafts);
      assert(
        isRecord(t1),
        `recordIrrigation wrong: ${JSON.stringify(t1.toolCalls.map((c) => [c.name, c.input]))}`,
      );
      assertEquals(called(t1, "confirmIrrigation").length, 0, "confirmIrrigation called in turn 1");
      const drafts = (await data.listIrrigations(10, { includeDrafts: true }))
        .filter((o) => o.status === "draft");
      assertEquals(drafts.length, 1, "expected exactly one draft");
      console.log(`[live] record turn-1 reply: ${t1.text}`);

      const t2 = await chatTurn(app, "oui");
      const conf = called(t2, "confirmIrrigation");
      assert(conf.length > 0, "confirmIrrigation not called on yes");
      assertEquals(conf[0].input?.confirmed, true);
      const ops = await data.listIrrigations(10, { includeDrafts: true });
      assert(
        ops.some((o) => o.status === "confirmed" && o.mm === 25 && o.date === YESTERDAY),
        "no confirmed 25 mm record",
      );
      assertEquals(ops.filter((o) => o.status === "draft").length, 0, "draft left behind");
      const after = (await service.getFieldReport(10, TODAY)).depletionMm;
      assert(after < before, `depletion did not drop: ${before} -> ${after}`);
    });

    await t.step("4. memory: a follow-up in the same thread works", async () => {
      const turn = await chatTurn(app, "Et pour Le Puits ?");
      assert(turn.text.trim().length > 0 || turn.toolCalls.length > 0, "no answer");
      const h = await (await app.request("/chat/history", { headers: HEADERS })).json();
      assert(h.data.messages.length >= 4, `history has ${h.data.messages.length} messages`);
    });

    console.log(
      `[live] model=${Deno.env.get("MODEL") ?? "default"} timings=${JSON.stringify(timings)}`,
    );
  },
});

Deno.test({
  name: "live: /irrigation/advice on the real Supabase (read-only)",
  ignore: !(LIVE && DB_TESTS),
  ...opts,
  async fn() {
    const { db } = await import("../../src/supabase.ts");
    const { createSupabaseFarmDirectory } = await import(
      "../../src/modules/irrigation/data/supabaseFarmData.ts"
    );
    const { createFarmRegistry } = await import("../../src/modules/irrigation/farmRegistry.ts");
    const { createIrrigationController } = await import(
      "../../src/modules/irrigation/irrigation.controller.ts"
    );
    const { Hono } = await import("hono");
    const { emptyOpenMeteoFetch } = await import("../helpers/testApp.ts");
    const registry = createFarmRegistry({
      directory: createSupabaseFarmDirectory(db),
      today: () => "2026-07-05",
      fetch: emptyOpenMeteoFetch,
    });
    const app = new Hono().route("/irrigation", createIrrigationController(registry));
    const res = await app.request("/irrigation/advice?date=2026-07-05");
    assertEquals(res.status, 200);
    const { data: advice } = await res.json();
    const r = advice.reports.find((x: { fieldId: number }) => x.fieldId === 10);
    assert(r, "no report for field 10");
    assertEquals(r.cropCode, "MAIZ");
    assert(typeof r.stageLabel === "string" && r.stageLabel.length > 0, "no stage label");
  },
});
