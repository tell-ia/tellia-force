import { assert, assertEquals, assertMatch } from "@std/assert";
import { Hono } from "hono";
import { onError } from "../src/core/middleware";
import { createVapiController, VAPI_SECRET_HEADER } from "../src/modules/vapi/vapi.controller";
import { VAPI_TOOLS, vapiFunctions } from "../src/modules/vapi/vapi.tools";
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
    assert(!text.includes("$schema") && !text.includes("additionalProperties"), f.name);
    assert(!text.includes(String(Number.MAX_SAFE_INTEGER)), f.name);
  }
});
