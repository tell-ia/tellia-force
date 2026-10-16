import { assert, assertEquals } from "@std/assert";
import { makeTestApp } from "./helpers/testApp";

const post = (
  app: { request: (u: string, i?: RequestInit) => Response | Promise<Response> },
  url: string,
  body: unknown,
) =>
  app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

Deno.test("GET /irrigation/advice returns three reports in the envelope", async () => {
  const { app } = makeTestApp();
  const res = await app.request("/irrigation/advice");
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.data.reports.length, 3);
  assertEquals(json.data.asOf, "2026-07-05");
  assertEquals((await app.request("/irrigation/advice?date=2026-07-04")).status, 200);
});

Deno.test("impossible date -> 400", async () => {
  const { app } = makeTestApp();
  const res = await app.request("/irrigation/advice?date=2026-13-45");
  assertEquals(res.status, 400);
  assertEquals((await app.request("/irrigation/fields/10/report?date=2026-13-45")).status, 400);
});

Deno.test("report: ok, unknown field 404 with ApiError envelope", async () => {
  const { app } = makeTestApp();
  const ok = await app.request("/irrigation/fields/10/report");
  assertEquals(ok.status, 200);
  assertEquals((await ok.json()).data.fieldId, 10);
  const res = await app.request("/irrigation/fields/999/report");
  assertEquals(res.status, 404);
  const json = await res.json();
  assertEquals(json.error.code, "http_404");
  assert(typeof json.error.message === "string");
  assertEquals((await app.request("/irrigation/fields/abc/report")).status, 400);
});

Deno.test("weather route returns 7 days", async () => {
  const { app } = makeTestApp();
  const res = await app.request("/irrigation/fields/10/weather");
  assertEquals(res.status, 200);
  assertEquals((await res.json()).data.length, 7);
});

Deno.test("simulate: drought ok, empty events 400", async () => {
  const { app } = makeTestApp();
  const res = await post(app, "/irrigation/fields/10/simulate", {
    events: [{ type: "drought", date: "2026-07-06", days: 5 }],
  });
  assertEquals(res.status, 200);
  const json = await res.json();
  assert(json.data.series.length > 0);
  assertEquals((await post(app, "/irrigation/fields/10/simulate", { events: [] })).status, 400);
});

Deno.test("operations: POST validation, 201 confirmed, GET lists it", async () => {
  const { app } = makeTestApp();
  const body = { fieldId: 10, date: "2026-07-04", mm: 20 };
  assertEquals((await post(app, "/irrigation/operations", { ...body, mm: -5 })).status, 400);
  assertEquals((await post(app, "/irrigation/operations", "{nope")).status, 400);
  assertEquals((await post(app, "/irrigation/operations", { ...body, fieldId: 999 })).status, 404);
  const res = await post(app, "/irrigation/operations", body);
  assertEquals(res.status, 201);
  const rec = (await res.json()).data;
  assertEquals(rec.status, "confirmed");
  assertEquals(rec.mm, 20);

  const list = await app.request("/irrigation/operations?fieldId=10");
  assertEquals(list.status, 200);
  const items = (await list.json()).data;
  assertEquals(items.length, 2);
  assertEquals(items[0].date, "2026-07-04");
  assertEquals((await app.request("/irrigation/operations")).status, 400);
  assertEquals((await app.request("/irrigation/operations?fieldId=999")).status, 404);
});
