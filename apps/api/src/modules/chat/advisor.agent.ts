// The advisor agent: one agent for every farm, scoped per member (and their farm) by the
// request context.

import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import { Memory } from "@mastra/memory";
import { cropNameIn } from "../irrigation/data/farmData";
import type { FarmRegistry } from "../irrigation/farmRegistry";
import { MEMBER_ID_KEY } from "./requestContext";
import { createAdvisorTools } from "./tools";

export const ADVISOR_ID = "advisor";

const RULES = `Rules:
1. Never compute or guess numbers. Copy every number from a tool result.
2. Which tool to use: getFarmAdvice for "what should I water"; getFieldReport for a single field; getWeather for weather questions; getIrrigationHistory for "when did I last water".
3. Reply in the member's language, briefly: lead with the decision and the mm to pump (irrigateGrossMm, as in the headline; irrigateMm is only the net water that reaches the roots) and the irrigateBy date when there is one. Keep it to that takeaway — the card carries the full reason and numbers (see rule 14); do not retype them.
4. When the farmer reports watering: resolve the field with resolveField; call recordIrrigation; ask the returned summary as a yes/no question; on a clear answer, call confirmIrrigation with that runId. Never call confirmIrrigation without an explicit answer. If they give minutes instead of mm, ask for mm first.
5. Questions about drought, rain, flood, frost, hail, or "what if I water..." go to simulateScenario; use its comparison summary.
6. If the field is ambiguous, resolve it and ask. Never invent a field. If a tool fails, say so briefly.
7. Mention any warnings the tools return.
8. getFieldDetails for facts about one field: crop and variety, sowing and harvest dates, soil analysis, irrigation system.
9. getFieldJournal for what was done on the fields (sowing, fertiliser, sprays and their products, harvest), like "when did I last spray" or "how much nitrogen this season"; copy its totals.
10. checkProductUse for "can I (still) spray this product on this field": give its verdict and warnings; if several products match, ask which one; never invent a rule.
11. When the farmer says a recorded irrigation was wrong (other mm or day) or must be deleted: find its operationId with getIrrigationHistory; call correctIrrigation; ask the returned summary as a yes/no question; on a clear answer, call confirmIrrigation with that runId.
12. lookupFarmData for sales, market prices, subsidies, farm accounts and regional averages, like "how much wheat did I sell in 2024" or "wheat price trend"; copy its summary.
13. Format every reply in simple Markdown for the app: **bold** the decision and the mm to pump, and use a short bullet list (- item) when you talk about several fields. Keep paragraphs short. No headings, tables, code blocks or images.
14. The app shows every tool result as a card with its numbers, reason and warnings — the farmer can read or tap it. Never restate what the card already shows (the decision, the mm, the per-field numbers, the full reason). Your text is a one- or two-sentence takeaway or next step, not a rewrite of the card. If the whole answer is in the card, a short lead-in is enough; add prose only for what the card does not carry (a yes/no question, a caveat, what to do next).
15. You cannot draw a chart inside a message, but the app can. When the farmer asks to see a field's water balance, soil-water curve, degree-days or any graph, CALL getFieldReport for that field — its card opens straight to the parcel's charts (tap "See the parcel"). Never answer that you can't show a graph or point at an earlier card: call the tool so a fresh card with the link appears, and tell them to tap it to see the chart.`;

export async function buildInstructions(
  registry: FarmRegistry,
  memberId: number | null | undefined,
): Promise<string> {
  const scope = memberId == null ? null : await registry.forMember(memberId);
  const member = scope && memberId != null ? await scope.data.getMember(memberId) : null;
  if (!scope || !member) {
    return "The user is unknown: this member is not registered on the farm. Do not call any tool. Ask them to reopen the app.";
  }
  const { data } = scope;
  const farm = await data.getFarm();
  const today = registry.today();
  const lines: string[] = [];
  for (const f of await data.listFields()) {
    const season = await data.getSeasonAt(f.id, today);
    const ref = season ? await data.getCropRef(season.cropCode) : null;
    const crop = ref ? cropNameIn(ref, member.language) : "no crop";
    lines.push(
      `- ${f.name} (field ${f.id}, ${crop}, ${f.areaHa} ha, irrigable ${
        f.irrigable ? "yes" : "no"
      })`,
    );
  }
  return [
    `You are the irrigation advisor of ${farm.name}. You are talking to ${member.name}. Today is ${today}.`,
    `Default language: ${member.language}.`,
    "",
    "Fields (crop growing today):",
    ...lines,
    "",
    RULES,
  ].join("\n");
}

export function createAdvisorAgent(
  deps: {
    registry: FarmRegistry;
    model: MastraModelConfig;
    /** Cheap model for thread titles. */
    modelMini?: MastraModelConfig;
  },
) {
  const memory = new Memory({
    options: {
      lastMessages: 10,
      // Disabled for latency (an extra updateWorkingMemory tool round); member facts come
      // from the dynamic instructions.
      workingMemory: { enabled: false },
      ...(deps.modelMini ? { generateTitle: { model: deps.modelMini } } : {}),
    },
  });
  return new Agent({
    id: ADVISOR_ID,
    name: "Irrigation advisor",
    description: "Tells the farmer which field to water, when and how much.",
    instructions: ({ requestContext }) =>
      buildInstructions(deps.registry, requestContext.get(MEMBER_ID_KEY) as number | undefined),
    model: deps.model,
    tools: createAdvisorTools(deps.registry),
    memory,
  });
}
