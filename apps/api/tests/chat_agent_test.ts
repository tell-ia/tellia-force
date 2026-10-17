import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { RequestContext } from "@mastra/core/request-context";
import { ADVISOR_ID, buildInstructions } from "../src/modules/chat/advisor.agent.ts";
import { FARM_ID_KEY, MEMBER_ID_KEY } from "../src/modules/chat/requestContext.ts";
import { makeTestMastra, makeTestRegistry } from "./helpers/testApp.ts";
import { scriptedModel } from "./helpers/scriptedModel.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };

function setup() {
  const calls: string[] = [];
  const registry = makeTestRegistry({
    wrap: (base) =>
      new Proxy(base, {
        get(t, k, r) {
          const v = Reflect.get(t, k, r);
          return typeof v === "function"
            ? (...a: unknown[]) => {
              calls.push(String(k));
              return v.apply(t, a);
            }
            : v;
        },
      }),
  });
  return { registry, calls };
}

/** The request context the member middleware builds for a member of a farm. */
function contextFor(member: number, farm: number) {
  const requestContext = new RequestContext();
  requestContext.set(MEMBER_ID_KEY, member);
  requestContext.set(FARM_ID_KEY, farm);
  return requestContext;
}

Deno.test("instructions: member 1 sees the farm, fields and the rules", opts, async () => {
  const { registry } = setup();
  const t = await buildInstructions(registry, 1);
  for (
    const s of [
      "Claire Lefèvre",
      "GAEC des Trois Chênes",
      "La Vallée (field 10, Maïs,",
      "Today is 2026-07-05",
      "Never compute or guess numbers",
      "confirmIrrigation",
      "simple Markdown",
    ]
  ) assertStringIncludes(t, s);
});

Deno.test("instructions: unknown member is told to reopen the app", opts, async () => {
  const { registry } = setup();
  const t = await buildInstructions(registry, 999);
  assertStringIncludes(t, "user is unknown");
  assertStringIncludes(t, "reopen the app");
});

Deno.test("agent run: getFarmAdvice then text, prompt knows the member", opts, async () => {
  const { registry, calls } = setup();
  const model = scriptedModel([
    { toolCalls: [{ name: "getFarmAdvice", input: {} }] },
    { text: "Arrosez La Vallée : 90 mm." },
  ]);
  const mastra = await makeTestMastra({ registry, model });
  const agent = mastra.getAgent(ADVISOR_ID);
  const requestContext = contextFor(1, 1);
  const out = await agent.generate("Quel champ arroser ?", { requestContext });
  assertEquals(out.text, "Arrosez La Vallée : 90 mm.");
  assert(calls.includes("getFieldReport"));
  assertStringIncludes(JSON.stringify(model.prompts[0]), "Claire Lefèvre");
});

Deno.test("two turns: record a draft, then confirm it with turn 1's runId", opts, async () => {
  const { registry } = setup();
  const { data } = await registry.forFarm(1);
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
  const mastra = await makeTestMastra({ registry, model });
  const agent = mastra.getAgent(ADVISOR_ID);
  const requestContext = contextFor(1, 1);
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

Deno.test(
  "instructions: a Spanish member sees only their farm, crops in Spanish",
  opts,
  async () => {
    const { registry } = setup();
    const t = await buildInstructions(registry, 5);
    for (
      const s of [
        "Elena Martín",
        "SAT Los Olmos",
        "El Pozo (field 15, Maíz,",
        "Default language: es",
      ]
    ) {
      assertStringIncludes(t, s);
    }
    for (const other of ["La Vallée", "GAEC des Trois Chênes", "Claire"]) {
      assert(!t.includes(other), `farm 1 leaked into farm 2's instructions: ${other}`);
    }
  },
);
