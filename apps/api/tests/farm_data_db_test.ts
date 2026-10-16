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
    const d = createSupabaseFarmData(db);
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
