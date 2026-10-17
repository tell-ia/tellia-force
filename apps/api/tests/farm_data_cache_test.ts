import { assert, assertEquals } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSupabaseFarmData,
  createSupabaseFarmDirectory,
} from "../src/modules/irrigation/data/supabaseFarmData.ts";

// Offline: a fake PostgREST client over in-memory tables. Checks that the farm-wide reads give
// the same answers as the per-field queries did, that a request reads each table once, and that
// a watering written through the API is seen by the very next read (no stale cache).

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  const reads: string[] = [];
  let nextId = 1000;
  function query(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    const orders: { col: string; asc: boolean; nullsFirst: boolean }[] = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row = {};
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] != null && r[c] !== v), q),
      not: (c: string) => (filters.push((r) => r[c] != null), q),
      is: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      lte: (
        c: string,
        v: string,
      ) => (filters.push((r) => r[c] != null && (r[c] as string) <= v), q),
      gte: (
        c: string,
        v: string,
      ) => (filters.push((r) => r[c] != null && (r[c] as string) >= v), q),
      order: (col: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) => (
        orders.push({
          col,
          asc: o.ascending ?? true,
          nullsFirst: o.nullsFirst ?? !(o.ascending ?? true),
        }), q
      ),
      range: () => q,
      limit: () => q,
      insert: (row: Row) => ((op = "insert"), (payload = row), q),
      update: (p: Row) => ((op = "update"), (payload = p), q),
      delete: () => ((op = "delete"), q),
      then(ok: (v: { data: Row[]; error: null }) => unknown, ko?: (e: unknown) => unknown) {
        const rows = (tables[table] ??= []);
        let data: Row[];
        if (op === "insert") {
          // DB trigger: farm_id comes from the field.
          const field = tables.field.find((f) => f.id === payload.field_id);
          const row = { id: nextId++, farm_id: field?.farm_id, ...payload };
          rows.push(row);
          data = [row];
        } else if (op === "update") {
          data = rows.filter((r) => filters.every((f) => f(r)));
          for (const r of data) Object.assign(r, payload);
        } else if (op === "delete") {
          data = rows.filter((r) => filters.every((f) => f(r)));
          tables[table] = rows.filter((r) => !data.includes(r));
        } else {
          reads.push(table);
          data = rows.filter((r) => filters.every((f) => f(r)));
          for (const o of [...orders].reverse()) {
            data = [...data].sort((a, b) => {
              const x = a[o.col] as string | number | null, y = b[o.col] as string | number | null;
              if (x == null || y == null) return x == y ? 0 : (x == null) === o.nullsFirst ? -1 : 1;
              return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1);
            });
          }
        }
        return Promise.resolve({ data, error: null }).then(ok, ko);
      },
    };
    return q;
  }
  return { db: { from: query } as unknown as SupabaseClient, reads, tables };
}

const tables = () => ({
  field: [
    { id: 1, farm_id: 1, name: "A", area_ha: 2, irrigable: true, irrigation_system_id: 7 },
    { id: 2, farm_id: 1, name: "B", area_ha: 3, irrigable: true, irrigation_system_id: null },
    { id: 3, farm_id: 2, name: "Other farm", area_ha: 1, irrigable: true },
  ],
  crop_season: [
    {
      id: 10,
      farm_id: 1,
      field_id: 1,
      crop_code: "MAIZ",
      sowing_date: "2025-04-20",
      harvest_date: "2025-10-01",
      status: "done",
    },
    {
      id: 11,
      farm_id: 1,
      field_id: 1,
      crop_code: "MAIZ",
      sowing_date: "2026-04-20",
      harvest_date: "2026-10-01",
      status: "growing",
    },
    {
      id: 12,
      farm_id: 1,
      field_id: 2,
      crop_code: "SUNF",
      sowing_date: null,
      harvest_date: "2026-09-01",
      status: "planned",
    },
    {
      id: 13,
      farm_id: 2,
      field_id: 3,
      crop_code: "MAIZ",
      sowing_date: "2026-04-01",
      harvest_date: "2026-10-01",
      status: "growing",
    },
  ],
  soil_analysis: [
    {
      id: 20,
      farm_id: 1,
      field_id: 1,
      sand_pct: 40,
      clay_pct: 20,
      organic_matter_pct: 2,
      sampled_on: null,
    },
    {
      id: 21,
      farm_id: 1,
      field_id: 1,
      sand_pct: 30,
      clay_pct: 25,
      organic_matter_pct: 2,
      sampled_on: "2024-03-01",
    },
    {
      id: 22,
      farm_id: 1,
      field_id: 1,
      sand_pct: 35,
      clay_pct: 22,
      organic_matter_pct: 2,
      sampled_on: "2022-03-01",
    },
  ],
  irrigation_system: [{ id: 7, farm_id: 1, name: "Reel gun", type: "reel_gun", efficiency: 0.8 }],
  operation: [
    {
      id: 1,
      farm_id: 1,
      field_id: 1,
      op_type: "irrigation",
      op_date: "2026-07-01",
      water_mm: 30,
      status: "confirmed",
      source: "web",
    },
    {
      id: 2,
      farm_id: 1,
      field_id: 1,
      op_type: "irrigation",
      op_date: "2026-07-05",
      water_mm: 25,
      status: "draft",
      source: "chat",
    },
    {
      id: 3,
      farm_id: 1,
      field_id: 2,
      op_type: "irrigation",
      op_date: "2026-07-02",
      water_mm: 20,
      status: "confirmed",
      source: "web",
    },
    {
      id: 4,
      farm_id: 1,
      field_id: 1,
      op_type: "sowing",
      op_date: "2026-04-20",
      water_mm: null,
      status: "confirmed",
      source: "web",
    },
  ],
  member: [{ id: 1, farm_id: 1 }, { id: 5, farm_id: 2 }],
});

Deno.test("farm data: season, soil and system answers match the per-field queries", async () => {
  const { db } = fakeDb(tables());
  const d = createSupabaseFarmData(db, 1);
  assertEquals((await d.getSeasonAt(1, "2026-07-15"))?.id, 11);
  assertEquals((await d.getSeasonAt(1, "2026-04-20"))?.id, 11, "sowing day is in the season");
  assertEquals((await d.getSeasonAt(1, "2025-10-01"))?.id, 10, "harvest day is in the season");
  assertEquals(await d.getSeasonAt(1, "2026-01-15"), null, "between seasons");
  assertEquals(await d.getSeasonAt(2, "2026-07-15"), null, "no sowing date: never in season");
  assertEquals(await d.getSeasonAt(3, "2026-07-15"), null, "another farm's field");
  assertEquals((await d.getSoil(1))?.sampledOn, "2024-03-01", "newest dated sample, undated last");
  assertEquals(await d.getSoil(2), null);
  assertEquals((await d.getIrrigationSystem(1))?.id, 7);
  assertEquals(await d.getIrrigationSystem(2), null);
  assertEquals((await d.listFields()).map((f) => f.id), [1, 2]);
});

Deno.test("farm data: one farm-wide read serves every field of a request", async () => {
  const { db, reads } = fakeDb(tables());
  const d = createSupabaseFarmData(db, 1);
  await Promise.all([1, 2, 1, 2].map((f) => d.getSeasonAt(f, "2026-07-15")));
  await Promise.all([1, 2].map((f) => d.listIrrigations(f, { includeDrafts: false })));
  await Promise.all([1, 2].map((f) => d.getIrrigationSystem(f)));
  assertEquals(reads.filter((t) => t === "crop_season").length, 1);
  assertEquals(reads.filter((t) => t === "operation").length, 1);
  assertEquals(reads.filter((t) => t === "field").length, 1);
});

Deno.test("farm data: irrigations keep the draft filter and only irrigation rows", async () => {
  const { db } = fakeDb(tables());
  const d = createSupabaseFarmData(db, 1);
  assertEquals((await d.listIrrigations(1, { includeDrafts: true })).map((o) => o.operationId), [
    1,
    2,
  ]);
  assertEquals((await d.listIrrigations(1, { includeDrafts: false })).map((o) => o.operationId), [
    1,
  ]);
});

Deno.test("farm data: a watering written through the API is seen by the next read", async () => {
  const { db } = fakeDb(tables());
  const d = createSupabaseFarmData(db, 1);
  const ids = async () =>
    (await d.listIrrigations(1, { includeDrafts: false })).map((o) => o.operationId);
  assertEquals(await ids(), [1]); // cached now

  const saved = await d.createIrrigation({
    fieldId: 1,
    seasonId: 11,
    date: "2026-07-10",
    mm: 30,
    status: "confirmed",
    source: "web",
    memberId: 1,
  });
  assertEquals(await ids(), [1, saved.operationId], "saved");

  await d.setIrrigationStatus(2, "confirmed");
  assertEquals(await ids(), [1, 2, saved.operationId], "draft confirmed");

  await d.updateIrrigation(saved.operationId, {
    date: "2026-07-11",
    mm: 35,
    seasonId: 11,
    dateChanged: true,
  });
  assertEquals((await d.listIrrigations(1, { includeDrafts: false })).at(-1)?.mm, 35, "corrected");

  await d.deleteIrrigation(saved.operationId);
  assertEquals(await ids(), [1, 2], "deleted");
});

Deno.test("farm directory: member -> farm is read once, a new member is still found", async () => {
  const fake = fakeDb(tables());
  const dir = createSupabaseFarmDirectory(fake.db);
  assertEquals(await dir.farmOfMember(1), 1);
  assertEquals(await dir.farmOfMember(5), 2);
  assertEquals(fake.reads.filter((t) => t === "member").length, 1);
  fake.tables.member.push({ id: 9, farm_id: 3 });
  assertEquals(await dir.farmOfMember(9), 3, "added since the last read");
  assertEquals(await dir.farmOfMember(404), null);
  assert(fake.reads.filter((t) => t === "member").length >= 2);
});
