import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { RequestContext } from "@mastra/core/request-context";
import { ADVISOR_ID, buildInstructions } from "../src/modules/chat/advisor.agent.ts";
import { MEMBER_ID_KEY } from "../src/modules/chat/requestContext.ts";
import { createMemoryFarmData } from "../src/modules/irrigation/data/memoryFarmData.ts";
import { createIrrigationService } from "../src/modules/irrigation/irrigation.service.ts";
import { createWeatherService } from "../src/modules/irrigation/weather/weatherService.ts";
import { makeFarmFixture } from "./fixtures/farm.ts";
import { emptyOpenMeteoFetch, makeTestMastra } from "./helpers/testApp.ts";
import { scriptedModel } from "./helpers/scriptedModel.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };

function setup() {
  const data = createMemoryFarmData(makeFarmFixture());
  const weather = createWeatherService({ data, fetch: emptyOpenMeteoFetch });
  const base = createIrrigationService({ data, weather, today: () => "2026-07-05" });
  const calls: string[] = [];
  const service = new Proxy(base, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      return typeof v === "function"
        ? (...a: unknown[]) => {
          calls.push(String(k));
          return v.apply(t, a);
        }
        : v;
    },
  });
  return { data, service, calls };
}

Deno.test("instructions: member 1 sees the farm, fields and the rules", opts, async () => {
  const { data, service } = setup();
  const t = await buildInstructions(service, data, 1);
  for (
    const s of [
      "Claire Lefèvre",
      "GAEC des Trois Chênes",
      "La Vallée (field 10, Maïs,",
      "Today is 2026-07-05",
      "Never compute or guess numbers",
      "confirmIrrigation",
    ]
  ) assertStringIncludes(t, s);
});

Deno.test("instructions: unknown member is told to reopen the app", opts, async () => {
  const { data, service } = setup();
  const t = await buildInstructions(service, data, 999);
  assertStringIncludes(t, "user is unknown");
  assertStringIncludes(t, "reopen the app");
});

Deno.test("agent run: getFarmAdvice then text, prompt knows the member", opts, async () => {
  const { data, service, calls } = setup();
  const model = scriptedModel([
    { toolCalls: [{ name: "getFarmAdvice", input: {} }] },
    { text: "Arrosez La Vallée : 90 mm." },
  ]);
  const mastra = await makeTestMastra({ service, data, model });
  const agent = mastra.getAgent(ADVISOR_ID);
  const requestContext = new RequestContext();
  requestContext.set(MEMBER_ID_KEY, 1);
  const out = await agent.generate("Quel champ arroser ?", { requestContext });
  assertEquals(out.text, "Arrosez La Vallée : 90 mm.");
  assert(calls.includes("getFieldReport"));
  assertStringIncludes(JSON.stringify(model.prompts[0]), "Claire Lefèvre");
});

Deno.test("two turns: record a draft, then confirm it with turn 1's runId", opts, async () => {
  const { data, service } = setup();
  const runIdFrom = (prompt: unknown[]) => {
    const m = JSON.stringify(prompt).match(/runId\\?":\\?"([0-9a-f-]{8,})/);
    assert(m, "runId not found in the prompt");
    return { runId: m[1], confirmed: true };
  };
  const model = scriptedModel([
    {
      toolCalls: [{ name: "recordIrrigation", input: { fieldId: 10, date: "2026-07-04", mm: 20 } }],
    },
    { text: "Confirmez-vous 20 mm sur La Vallée ?" },
    { toolCalls: [{ name: "confirmIrrigation", input: runIdFrom }] },
    { text: "C'est noté." },
  ]);
  const mastra = await makeTestMastra({ service, data, model });
  const agent = mastra.getAgent(ADVISOR_ID);
  const requestContext = new RequestContext();
  requestContext.set(MEMBER_ID_KEY, 1);
  const memory = { thread: "t-1", resource: "member-1" };
  await agent.generate("J'ai arrosé La Vallée 20 mm hier", { requestContext, memory });
  const drafts = (await data.listIrrigations(10, { includeDrafts: true }))
    .filter((o) => o.mm === 20);
  assertEquals(drafts.length, 1);
  assertEquals(drafts[0].status, "draft");
  await agent.generate("Oui", { requestContext, memory });
  const after = (await data.listIrrigations(10, { includeDrafts: true })).filter((o) =>
    o.mm === 20
  );
  assertEquals(after.length, 1);
  assertEquals(after[0].status, "confirmed");
});
