import { assert, assertEquals, assertMatch } from "@std/assert";
import { Hono } from "hono";
import { onError } from "../src/core/middleware";
import { createVapiController, VAPI_SECRET_HEADER } from "../src/modules/vapi/vapi.controller";
import { VAPI_TOOLS, vapiFunctions, VOICE_JOURNAL_ENTRIES } from "../src/modules/vapi/vapi.tools";
import { makeTestRegistry, TEST_TODAY } from "./helpers/testApp";

const SECRET = "test-secret-0123456789";
/** Elena Martín, main contact of farm 2 (SAT Los Olmos). */
const ELENA_PHONE = "+34600000005";

function makeVapiApp({ secret }: { secret?: string } = { secret: SECRET }) {
  const registry = makeTestRegistry();
  const app = new Hono();
  app.onError(onError);
  app.route(
    "/vapi",
    createVapiController({
      registry,
      secret,
      memberByPhone: (phone) => Promise.resolve(phone === ELENA_PHONE ? 5 : null),
    }),
  );
  return { app, registry };
}

type Call = { name: string; arguments?: unknown };

function toolCalls(calls: Call[], phone?: string) {
  return {
    message: {
      type: "tool-calls",
      toolCallList: calls.map((c, i) => ({
        id: `call_${i}`,
        type: "function",
        function: { name: c.name, arguments: c.arguments },
      })),
      call: phone ? { customer: { number: phone } } : {},
    },
  };
}

function post(app: Hono, body: unknown, secret: string | null = SECRET) {
  return app.request("/vapi/tools", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret === null ? {} : { [VAPI_SECRET_HEADER]: secret }),
    },
    body: JSON.stringify(body),
  });
}

/** Runs tool calls and returns VAPI's `results`, with `result` parsed back from JSON. */
async function call(app: Hono, calls: Call[], phone?: string) {
  const res = await post(app, toolCalls(calls, phone));
  assertEquals(res.status, 200);
  const { results } = await res.json();
  return results.map((r: { toolCallId: string; result?: string; error?: string }) => ({
    ...r,
    data: r.result === undefined ? undefined : JSON.parse(r.result),
  }));
}

Deno.test("vapi: missing, wrong or unconfigured secret -> 401", async () => {
  const body = toolCalls([{ name: "get_farm_advice", arguments: {} }]);
  const { app } = makeVapiApp();
  assertEquals((await post(app, body, null)).status, 401);
  assertEquals((await post(app, body, "nope")).status, 401);
  const { app: off } = makeVapiApp({});
  assertEquals((await post(off, body, SECRET)).status, 401);
});

Deno.test("vapi: other server messages get an empty 200, junk gets 400", async () => {
  const { app } = makeVapiApp();
  const res = await post(app, { message: { type: "status-update", status: "ended" } });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {});
  assertEquals((await post(app, { hello: 1 })).status, 400);
});

Deno.test("vapi: unknown caller gets the default farm, with today in every result", async () => {
  const { app } = makeVapiApp();
  const [r] = await call(app, [{ name: "get_farm_advice", arguments: {} }], "+10000000000");
  assertEquals(r.toolCallId, "call_0");
  assertEquals(r.data.today, TEST_TODAY);
  assertEquals(r.data.fields.length, 3);
  assert(!("kc" in r.data.fields[0]), "results stay short for the voice");
});

Deno.test("vapi: a member's phone picks their farm", async () => {
  const { app } = makeVapiApp();
  const [advice, match] = await call(app, [
    { name: "get_farm_advice", arguments: {} },
    { name: "resolve_field", arguments: { query: "pozo" } },
  ], ELENA_PHONE);
  assertEquals(advice.data.fields.map((f: { fieldId: number }) => f.fieldId), [15]);
  assertEquals(match.data.matches[0].fieldId, 15);
  // Another farm's field is not found.
  const [other] = await call(
    app,
    [{ name: "get_field_report", arguments: { fieldId: 10 } }],
    ELENA_PHONE,
  );
  assert(other.error);
});

Deno.test("vapi: arguments as a JSON string still work", async () => {
  const { app } = makeVapiApp();
  const [r] = await call(app, [{ name: "get_field_report", arguments: '{"fieldId":10}' }]);
  assertEquals(r.data.fieldId, 10);
  assertEquals(r.data.asOf, TEST_TODAY);
});

Deno.test("vapi: bad arguments, unknown tool and unknown field become one-line errors", async () => {
  const { app } = makeVapiApp();
  const results = await call(app, [
    { name: "get_field_report", arguments: { fieldId: "ten" } },
    { name: "water_everything", arguments: {} },
    { name: "get_field_report", arguments: { fieldId: 999 } },
    { name: "get_weather", arguments: { fieldId: 10, date: "2026-13-45" } },
  ]);
  for (const r of results) {
    assertEquals(r.result, undefined);
    assertEquals(typeof r.error, "string");
    assert(!r.error.includes("\n"), `one line: ${r.error}`);
  }
  assertMatch(results[1].error, /unknown tool/);
});

Deno.test("vapi: weather, history and simulate on the default farm", async () => {
  const { app } = makeVapiApp();
  const [weather, history, sim, noMm] = await call(app, [
    { name: "get_weather", arguments: { fieldId: 10 } },
    { name: "get_irrigation_history", arguments: { fieldId: 10 } },
    {
      name: "simulate_scenario",
      arguments: { fieldId: 10, events: [{ type: "drought", date: "2026-07-06", days: 5 }] },
    },
    {
      name: "simulate_scenario",
      arguments: { fieldId: 10, events: [{ type: "irrigation", date: "2026-07-06" }] },
    },
  ]);
  assertEquals(weather.data.days.length, 7);
  assert(Array.isArray(history.data.records));
  assertEquals(typeof sim.data.comparison.summary, "string");
  assertEquals(sim.data.before.fieldId, 10);
  assert(noMm.error, "an irrigation event needs mm");
});

Deno.test("vapi: record_irrigation saves for a member, refuses an unknown caller", async () => {
  const { app, registry } = makeVapiApp();
  const args = { fieldId: 15, date: "2026-07-04", mm: 20 };
  const [saved] = await call(app, [{ name: "record_irrigation", arguments: args }], ELENA_PHONE);
  assertEquals(saved.data.saved, true);
  assertEquals(saved.data.record.status, "confirmed");
  const ops = await (await registry.forFarm(2)).data.listIrrigations(15, { includeDrafts: true });
  const op = ops.find((o) => o.operationId === saved.data.record.operationId);
  assertEquals(op?.source, "phone_call");
  assertEquals(op?.memberId, 5);

  const [refused] = await call(app, [
    { name: "record_irrigation", arguments: { ...args, fieldId: 10 } },
  ]);
  assertMatch(refused.error, /not a farm member/);
});

Deno.test("vapi: function definitions are plain JSON Schema objects", () => {
  const fns = vapiFunctions();
  assertEquals(fns.map((f) => f.name), Object.keys(VAPI_TOOLS));
  for (const f of fns) {
    assertEquals(f.parameters.type, "object");
    const text = JSON.stringify(f.parameters);
    for (
      const k of ["$schema", "additionalProperties", "minimum", "exclusiveMinimum", "minItems"]
    ) {
      assert(!text.includes(`"${k}"`), `${f.name}: ${k}`);
    }
  }
  const sim = fns.find((f) => f.name === "simulate_scenario")!.parameters as {
    properties: { events: { items: { required: string[] } } };
  };
  assertEquals(sim.properties.events.items.required, ["type", "date"]);
});

Deno.test("vapi: get_field_details gives a short flat answer", async () => {
  const { app } = makeVapiApp();
  const [r] = await call(app, [{ name: "get_field_details", arguments: { fieldId: 10 } }]);
  assertEquals(r.data.fieldName, "La Vallée");
  assertEquals(r.data.cropName, "Maïs");
  assertEquals(r.data.previousCrop, "Blé tendre d'hiver");
  assertEquals(r.data.soilTexture, "Sandy loam");
  assertEquals(r.data.ph, 6.4);
  assertEquals(r.data.irrigationSystem, null);
  for (const [k, v] of Object.entries(r.data)) {
    assert(v === null || typeof v !== "object", `${k} is nested`);
  }
});

Deno.test("vapi: get_field_journal: totals from the server, products as short strings", async () => {
  const { app } = makeVapiApp();
  const [field, sprays, farm, bad] = await call(app, [
    { name: "get_field_journal", arguments: { fieldId: 10 } },
    { name: "get_field_journal", arguments: { fieldId: 10, type: "spraying" } },
    { name: "get_field_journal", arguments: {} },
    { name: "get_field_journal", arguments: { type: "weeding" } },
  ]);
  assertEquals(field.data.fieldName, "La Vallée");
  assertEquals(field.data.entries.length, 8);
  assertEquals(field.data.truncated, false);
  assertEquals(field.data.totals.nKgHa, 110);
  assertEquals(field.data.totals.irrigationMm, 30);
  assertEquals(field.data.entries[0].planned, true);
  assert(!("operationId" in field.data.entries[0]), "no ids for the voice");
  assertEquals(sprays.data.entries[1].products, ["ADENGO 0.33 L/ha", "CALLISTO 0.75 L/ha"]);
  assert(!("products" in field.data.entries[1]), "no empty product list");
  // 11 entries on the farm: the voice gets 10 and knows there are more.
  assertEquals(farm.data.entries.length, VOICE_JOURNAL_ENTRIES);
  assertEquals(farm.data.truncated, true);
  assertEquals(farm.data.totals.count, 10);
  assertMatch(bad.error, /type/);
});

Deno.test("vapi: field details and journal stay on the caller's farm", async () => {
  const { app } = makeVapiApp();
  const [details, journal, own] = await call(app, [
    { name: "get_field_details", arguments: { fieldId: 10 } },
    { name: "get_field_journal", arguments: { fieldId: 10 } },
    { name: "get_field_journal", arguments: {} },
  ], ELENA_PHONE);
  assertMatch(details.error, /field 10 not found/);
  assertMatch(journal.error, /field 10 not found/);
  assert(own.data.entries.every((e: { fieldName: string }) => e.fieldName === "El Pozo"));
  assertEquals(own.data.totals.nKgHa, 90);
});
