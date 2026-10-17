import { assertEquals, assertThrows } from "@std/assert";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { DEMO_DATE_MIN } from "@tellia/shared/app";
import { onError } from "../src/core/middleware";
import { createIrrigationController } from "../src/modules/irrigation/irrigation.controller";
import { createClock, type DemoDateStore, fileDemoDateStore } from "../src/modules/settings/clock";
import { createSettingsController } from "../src/modules/settings/settings.controller";
import { createVapiController, VAPI_SECRET_HEADER } from "../src/modules/vapi/vapi.controller";
import { closeOpenSmsConversations } from "../src/modules/vapi/vapiSessions";
import { makeTestRegistry, TEST_TODAY } from "./helpers/testApp";

/** 2026-07-05 at noon, Paris time: the test farms' "today". */
const now = () => new Date(`${TEST_TODAY}T10:00:00Z`);

function memoryStore(initial: string | null = null) {
  const saved: (string | null)[] = [];
  const store: DemoDateStore = {
    load: () => initial,
    save: (d) => void saved.push(d),
  };
  return { store, saved };
}

const status = (f: () => void) => {
  try {
    f();
  } catch (e) {
    if (e instanceof HTTPException) return e.status;
    throw e;
  }
  return 200;
};

Deno.test("clock: real date by default, DEMO_DATE as fallback, the demo date first", () => {
  assertEquals(createClock({ timezone: "Europe/Paris", now }).today(), TEST_TODAY);
  const clock = createClock({ timezone: "Europe/Paris", fallback: "2022-07-13", now });
  assertEquals(clock.today(), "2022-07-13");
  assertEquals(clock.realToday(), TEST_TODAY);
  clock.setDemoDate("2021-07-15");
  assertEquals(clock.today(), "2021-07-15");
  assertEquals(clock.demoDate(), "2021-07-15");
  clock.setDemoDate(null);
  assertEquals(clock.today(), "2022-07-13");
  assertEquals(clock.demoDate(), null);
});

Deno.test("clock: the demo date stays between the first weather day and the real today", () => {
  const clock = createClock({ timezone: "Europe/Paris", now });
  assertEquals(status(() => clock.setDemoDate("2026-07-06")), 400);
  assertEquals(status(() => clock.setDemoDate("2014-12-31")), 400);
  assertEquals(status(() => clock.setDemoDate(DEMO_DATE_MIN)), 200);
  assertEquals(status(() => clock.setDemoDate(TEST_TODAY)), 200);
  assertEquals(clock.today(), TEST_TODAY);
});

Deno.test("clock: saves each change and restores a valid stored date", () => {
  const { store, saved } = memoryStore("2026-07-15");
  // Stored date after the real today: dropped.
  assertEquals(createClock({ timezone: "Europe/Paris", now, store }).demoDate(), null);
  const ok = memoryStore("2022-07-13");
  const clock = createClock({ timezone: "Europe/Paris", now, store: ok.store });
  assertEquals(clock.today(), "2022-07-13");
  clock.setDemoDate("2021-07-15");
  clock.setDemoDate(null);
  assertEquals(ok.saved, ["2021-07-15", null]);
  assertEquals(saved, []);
  assertThrows(() => clock.setDemoDate("13/07/2022"), HTTPException);
  assertEquals(createClock({ timezone: "Europe/Paris", now, store: memoryStore("junk").store })
    .demoDate(), null);
});

Deno.test("file store: writes, reads back, removes on null", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = fileDemoDateStore(`${dir}/sub/demo-date.json`);
    assertEquals(store.load(), null);
    store.save("2022-07-13");
    assertEquals(store.load(), "2022-07-13");
    store.save(null);
    assertEquals(store.load(), null);
    await Deno.writeTextFile(`${dir}/sub/demo-date.json`, "{not json");
    assertEquals(store.load(), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/** /settings, /irrigation and /vapi on one clock, like main.ts. */
function makeApp() {
  const clock = createClock({ timezone: "Europe/Paris", now });
  const registry = makeTestRegistry({ today: () => clock.today() });
  const app = new Hono();
  app.onError(onError);
  app.route("/settings", createSettingsController(clock));
  app.route("/irrigation", createIrrigationController(registry));
  app.route(
    "/vapi",
    createVapiController({ registry, secret: "s", memberByPhone: () => Promise.resolve(null) }),
  );
  return app;
}

const put = (app: Hono, body: unknown) =>
  app.request("/settings/date", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

Deno.test("GET/PUT /settings/date", async () => {
  const app = makeApp();
  let res = await app.request("/settings/date");
  assertEquals((await res.json()).data, {
    today: TEST_TODAY,
    realToday: TEST_TODAY,
    demoDate: null,
    min: DEMO_DATE_MIN,
    max: TEST_TODAY,
  });

  res = await put(app, { date: "2026-07-01" });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).data.today, "2026-07-01");

  for (const bad of [{ date: "2026-07-06" }, { date: "01/07/2026" }, {}]) {
    res = await put(app, bad);
    assertEquals(res.status, 400, JSON.stringify(bad));
    assertEquals((await res.json()).error.code, "http_400");
  }

  res = await put(app, { date: null });
  assertEquals((await res.json()).data, {
    today: TEST_TODAY,
    realToday: TEST_TODAY,
    demoDate: null,
    min: DEMO_DATE_MIN,
    max: TEST_TODAY,
  });
});

Deno.test("the demo date moves the advice and the phone tools' today", async () => {
  const app = makeApp();
  await put(app, { date: "2026-07-01" });

  const advice = await (await app.request("/irrigation/advice")).json();
  assertEquals(advice.data.asOf, "2026-07-01");

  const res = await app.request("/vapi/tools", {
    method: "POST",
    headers: { "content-type": "application/json", [VAPI_SECRET_HEADER]: "s" },
    body: JSON.stringify({
      message: {
        type: "tool-calls",
        toolCallList: [{ id: "t", function: { name: "resolve_field", arguments: { query: "x" } } }],
      },
    }),
  });
  const result = JSON.parse((await res.json()).results[0].result);
  assertEquals(result.today, "2026-07-01");
});

Deno.test("PUT /settings/date runs onDateChange only when today changes", async () => {
  const clock = createClock({ timezone: "Europe/Paris", now });
  const changes: string[] = [];
  const app = new Hono();
  app.onError(onError);
  app.route("/settings", createSettingsController(clock, { onDateChange: (d) => changes.push(d) }));

  await put(app, { date: "2021-07-15" });
  await put(app, { date: "2021-07-15" }); // same day: nothing to do
  await put(app, { date: "2027-01-01" }); // refused
  await put(app, { date: null });
  assertEquals(changes, ["2021-07-15", TEST_TODAY]);
});

Deno.test("closeOpenSmsConversations closes only the open SMS conversations", async () => {
  const seen: string[] = [];
  const fakeVapi: typeof fetch = (input, init) => {
    const url = String(input);
    seen.push(`${init?.method} ${url.replace("https://api.vapi.ai", "")} ${init?.body ?? ""}`);
    assertEquals((init?.headers as Record<string, string>).authorization, "Bearer k");
    if (init?.method === "GET") {
      return Promise.resolve(Response.json([
        { id: "a", status: "active", phoneNumberId: "p1" },
        { id: "b", status: "completed", phoneNumberId: "p1" },
        { id: "c", status: "active" }, // not an SMS conversation
        { id: "d", status: "active", phoneNumberId: "p2" },
      ]));
    }
    return Promise.resolve(Response.json({}));
  };
  assertEquals(await closeOpenSmsConversations({ privateKey: "k", fetch: fakeVapi }), 2);
  assertEquals(seen, [
    "GET /session?limit=1000 ",
    'PATCH /session/a {"status":"completed"}',
    'PATCH /session/d {"status":"completed"}',
  ]);

  const down: typeof fetch = () => Promise.resolve(new Response("nope", { status: 401 }));
  let failed = false;
  try {
    await closeOpenSmsConversations({ privateKey: "k", fetch: down });
  } catch {
    failed = true;
  }
  assertEquals(failed, true);
});
