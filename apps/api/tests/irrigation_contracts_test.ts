import { assert, assertEquals } from "@std/assert";
import {
  AdviceQuerySchema,
  DecisionSchema,
  FieldReportSchema,
  RecordIrrigationBodySchema,
  ScenarioEventSchema,
  SimulateBodySchema,
} from "@tellia/shared/irrigation";
import { parseEnv, ServerEnvSchema } from "@tellia/shared/env";

Deno.test("ScenarioEventSchema applies defaults", () => {
  const flood = ScenarioEventSchema.parse({ type: "flood", date: "2026-07-06" });
  assertEquals(flood, { type: "flood", date: "2026-07-06", mm: 120 });
  const frost = ScenarioEventSchema.parse({ type: "frost", date: "2026-07-06" });
  assertEquals(frost, { type: "frost", date: "2026-07-06", tmin: -3 });
  const drought = ScenarioEventSchema.parse({ type: "drought", date: "2026-07-06", days: 5 });
  assertEquals(drought, { type: "drought", date: "2026-07-06", days: 5, et0Factor: 1.3 });
  assertEquals(ScenarioEventSchema.parse({ type: "hail", date: "2026-07-06" }).type, "hail");
});

Deno.test("ScenarioEventSchema rejects bad input", () => {
  const bad = [
    { type: "rain", date: "2026-07-06", mm: 0 },
    { type: "irrigation", date: "2026-07-06", mm: 201 },
    { type: "volcano", date: "2026-07-06" },
    { type: "rain", date: "06/07/2026", mm: 10 },
    { type: "frost", date: "2026-07-06", tmin: 2 },
    { type: "drought", date: "2026-07-06", days: 31 },
    { type: "flood", date: "2026-07-06", mm: 10 },
  ];
  for (const b of bad) assert(!ScenarioEventSchema.safeParse(b).success, JSON.stringify(b));
});

Deno.test("request bodies", () => {
  assert(
    !RecordIrrigationBodySchema.safeParse({ fieldId: 10, date: "2026-07-05", mm: -5 }).success,
  );
  assert(
    !RecordIrrigationBodySchema.safeParse({ fieldId: 10, date: "2026-07-05", mm: 250 }).success,
  );
  assert(RecordIrrigationBodySchema.safeParse({ fieldId: 10, date: "2026-07-05", mm: 30 }).success);
  assert(!SimulateBodySchema.safeParse({ events: [] }).success);
  assert(AdviceQuerySchema.safeParse({}).success);
  assertEquals(DecisionSchema.options.length, 6);
  assert(FieldReportSchema.shape.depletionPct);
});

Deno.test("env: DEMO_DATE optional ISO, defaults", () => {
  const base = {
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SECRET_KEY: "k",
    OPENAI_API_KEY: "k",
    VAPI_PHONE_NUMBER: "+1",
  };
  const ok = parseEnv(ServerEnvSchema, base);
  assertEquals(ok.DEMO_DATE, undefined);
  assertEquals(ok.MODEL, "openai/gpt-5-mini");
  assertEquals(ok.MASTRA_DB_URL, "file:./data/mastra.db");
  assertEquals(ok.TIMEZONE, "Europe/Paris");
  assertEquals(
    parseEnv(ServerEnvSchema, { ...base, DEMO_DATE: "2026-07-05" }).DEMO_DATE,
    "2026-07-05",
  );
  let threw = false;
  try {
    parseEnv(ServerEnvSchema, { ...base, DEMO_DATE: "05/07/2026" });
  } catch {
    threw = true;
  }
  assert(threw);
});
