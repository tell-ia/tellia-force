// The Mastra instance: advisor agent, the four workflows, LibSQL storage and POST /chat.

import { Mastra } from "@mastra/core";
import type { MastraModelConfig } from "@mastra/core/llm";
import { chatRoute } from "@mastra/ai-sdk";
import { MastraServer } from "@mastra/hono";
import { LibSQLStore } from "@mastra/libsql";
import type { Hono } from "hono";
import type { FarmData } from "../irrigation/data/farmData";
import type { IrrigationService } from "../irrigation/irrigation.service";
import { ADVISOR_ID, createAdvisorAgent } from "./advisor.agent";
import { createChatRoutes } from "./chat.routes";
import { createMemberMiddleware } from "./member.middleware";
import { createAdvisorWorkflows } from "./workflows/index";

export const MAX_CHAT_STEPS = 6;

export function createMastra(
  opts: {
    service: IrrigationService;
    data: FarmData;
    model: MastraModelConfig;
    /** Cheap model for thread titles. */
    modelMini?: MastraModelConfig;
    storageUrl: string;
  },
) {
  const { service, data } = opts;
  const workflows = createAdvisorWorkflows(service, data);
  return new Mastra({
    storage: new LibSQLStore({ id: "mastra-store", url: opts.storageUrl }),
    agents: {
      [ADVISOR_ID]: createAdvisorAgent({
        service,
        data,
        model: opts.model,
        modelMini: opts.modelMini,
      }),
    },
    workflows: {
      "farm-advice": workflows.farmAdvice,
      "simulate-scenario": workflows.simulateScenario,
      "record-irrigation": workflows.recordIrrigation,
      "morning-warmup": workflows.morningWarmup,
    },
    server: {
      // The app's own CORS (registered first) handles preflights, including x-member-id.
      cors: false,
      middleware: createMemberMiddleware(service, data),
      apiRoutes: [
        chatRoute({
          path: "/chat",
          agent: ADVISOR_ID,
          version: "v7",
          defaultOptions: { maxSteps: MAX_CHAT_STEPS },
        }),
      ],
    },
  });
}

/**
 * Mounts GET /chat/history, then Mastra's routes (POST /chat, /api/*) on the app.
 * Must run after the app's CORS middleware and before Deno.serve.
 */
export async function mountChat(
  app: Hono,
  deps: { mastra: Mastra; service: IrrigationService; data: FarmData },
) {
  app.route("/chat", createChatRoutes(deps));
  const server = new MastraServer({ app, mastra: deps.mastra });
  await server.init();
}
