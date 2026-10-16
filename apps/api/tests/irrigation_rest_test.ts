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
  const { app } = await makeTestApp();
  const res = await app.request("/irrigation/advice");
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.data.reports.length, 3);
  assertEquals(json.data.asOf, "2026-07-05");
  assertEquals((await app.request("/irrigation/advice?date=2026-07-04")).status, 200);
});

Deno.test("impossible date -> 400", async () => {
  const { app } = await makeTestApp();
  const res = await app.request("/irrigation/advice?date=2026-13-45");
  assertEquals(res.status, 400);
  assertEquals((await app.request("/irrigation/fields/10/report?date=2026-13-45")).status, 400);
});

Deno.test("report: ok, unknown field 404 with ApiError envelope", async () => {
  const { app } = await makeTestApp();
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
  const { app } = await makeTestApp();
  const res = await app.request("/irrigation/fields/10/weather");
  assertEquals(res.status, 200);
  assertEquals((await res.json()).data.length, 7);
});

Deno.test("simulate: drought ok, empty events 400", async () => {
  const { app } = await makeTestApp();
  const res = await post(app, "/irrigation/fields/10/simulate", {
    events: [{ type: "drought", date: "2026-07-06", days: 5 }],
  });
  assertEquals(res.status, 200);
  const json = await res.json();
  assert(json.data.series.length > 0);
  assertEquals((await post(app, "/irrigation/fields/10/simulate", { events: [] })).status, 400);
});

Deno.test("operations: POST validation, 201 confirmed, GET lists it", async () => {
  const { app } = await makeTestApp();
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

Deno.test("validation errors use the ApiError envelope (http_400)", async () => {
  const { app } = await makeTestApp();
  const bad = [
    await app.request("/irrigation/advice?date=2026-13-45"),
    await post(app, "/irrigation/fields/10/simulate", { events: [] }),
    await post(app, "/irrigation/operations", { fieldId: 10, date: "2026-07-04", mm: -5 }),
  ];
  for (const res of bad) {
    assertEquals(res.status, 400);
    const json = await res.json();
    assertEquals(json.error.code, "http_400");
    assert(typeof json.error.message === "string" && json.error.message.length > 0);
    assertEquals(json.success, undefined);
  }
});

// ---- several farms: the caller's farm only (x-member-id) ----

const as = (member: string) => ({ headers: { "x-member-id": member } });

Deno.test("REST: a member of farm 2 gets farm 2's advice only, crops in Spanish", async () => {
  const { app } = await makeTestApp();
  const res = await app.request("/irrigation/advice", as("5"));
  assertEquals(res.status, 200);
  const { data } = await res.json();
  assertEquals(data.reports.map((r: { fieldId: number }) => r.fieldId), [15]);
  assertEquals(data.reports[0].cropName, "Maíz");
});

Deno.test("REST: another farm's field is 404, unknown member is 400", async () => {
  const { app } = await makeTestApp();
  assertEquals((await app.request("/irrigation/fields/10/report", as("5"))).status, 404);
  assertEquals((await app.request("/irrigation/fields/15/report", as("1"))).status, 404);
  assertEquals((await app.request("/irrigation/operations?fieldId=10", as("5"))).status, 404);
  const bad = await app.request("/irrigation/advice", as("999"));
  assertEquals(bad.status, 400);
  assertEquals((await bad.json()).error.code, "http_400");
  assertEquals((await app.request("/irrigation/advice", as("abc"))).status, 400);
});

Deno.test("REST: no cross-farm writes", async () => {
  const { app, registry } = await makeTestApp();
  const write = (member: string, body: unknown) =>
    app.request("/irrigation/operations", {
      method: "POST",
      headers: { "content-type": "application/json", "x-member-id": member },
      body: JSON.stringify(body),
    });
  // Farm 2's member on a farm 1 field.
  assertEquals((await write("5", { fieldId: 10, date: "2026-07-04", mm: 20 })).status, 404);
  // Farm 2's caller naming a farm 1 member.
  assertEquals(
    (await write("5", { fieldId: 15, date: "2026-07-04", mm: 20, memberId: 1 })).status,
    400,
  );
  const farm1 = (await registry.forFarm(1)).data;
  assertEquals((await farm1.listIrrigations(10, { includeDrafts: true })).length, 1);
  // A valid write lands on the caller's farm only.
  assertEquals((await write("5", { fieldId: 15, date: "2026-07-04", mm: 20 })).status, 201);
  const farm2 = (await registry.forFarm(2)).data;
  assertEquals((await farm2.listIrrigations(15, { includeDrafts: false })).length, 2);
});
