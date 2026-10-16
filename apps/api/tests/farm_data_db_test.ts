import { assert, assertEquals } from "@std/assert";

// Read-only integration test against the real DB. Opt-in: RUN_DB_TESTS=1.
Deno.test({
  name: "supabase FarmData reads real data (read-only)",
  ignore: Deno.env.get("RUN_DB_TESTS") !== "1",
  async fn() {
    const { db } = await import("../src/supabase.ts");
    const { createSupabaseFarmData } = await import(
      "../src/modules/irrigation/data/supabaseFarmData.ts"
    );
    const d = createSupabaseFarmData(db, 1);
    assert((await d.getFarm()).name.length > 0);
    assertEquals((await d.listFields()).find((f) => f.id === 10)?.irrigable, true);
    assertEquals((await d.getSeasonAt(10, "2026-07-05"))?.cropCode, "MAIZ");
    assertEquals((await d.getWeather("2026-07-01", "2026-07-03")).length, 3);
    const clim = await d.getGddClimatology(6);
    assert(clim.size >= 360 && clim.size <= 366, `climatology keys: ${clim.size}`);
    assert((await d.listIrrigations(10, { includeDrafts: false })).length >= 3);
    assertEquals((await d.getMember(1))?.mainContact, true);
  },
});

Deno.test({
  name:
    "supabase FarmDirectory: 3 farms, members map to their farm, data is farm-scoped (read-only)",
  ignore: Deno.env.get("RUN_DB_TESTS") !== "1",
  async fn() {
    const { db } = await import("../src/supabase.ts");
    const { createSupabaseFarmDirectory } = await import(
      "../src/modules/irrigation/data/supabaseFarmData.ts"
    );
    const dir = createSupabaseFarmDirectory(db);
    assertEquals(await dir.listFarmIds(), [1, 2, 3]);
    assertEquals(await dir.defaultMemberId(), 1);
    assertEquals(await dir.farmOfMember(5), 2);
    assertEquals(await dir.farmOfMember(9), 3);
    const es = dir.forFarm(2);
    assertEquals((await es.getFarm()).name, "SAT Los Olmos");
    assertEquals(await es.getMember(1), null, "farm 1's member visible from farm 2");
    const fields = (await es.listFields()).map((f) => f.id);
    assert(fields.includes(15) && !fields.includes(10), `farm 2 fields: ${fields}`);
    // Same dates, different regions: Valladolid and Loiret weather differ.
    const [w1] = await dir.forFarm(1).getWeather("2026-07-01", "2026-07-01");
    const [w2] = await es.getWeather("2026-07-01", "2026-07-01");
    assert(w1 && w2 && w1.et0 !== w2.et0, "weather is not per region");
  },
});
