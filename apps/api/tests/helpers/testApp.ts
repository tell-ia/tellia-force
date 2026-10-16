import { cors } from "hono/cors";
import { createMastra, mountChat } from "../../src/modules/chat/mastra";
import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { Hono } from "hono";
import { ADVISOR_ID, createAdvisorAgent } from "../../src/modules/chat/advisor.agent";
import { createAdvisorWorkflows } from "../../src/modules/chat/workflows/index";
import type { FarmData } from "../../src/modules/irrigation/data/farmData";
import { onError } from "../../src/core/middleware";
import { createMemoryFarmData } from "../../src/modules/irrigation/data/memoryFarmData";
import { createIrrigationController } from "../../src/modules/irrigation/irrigation.controller";
import {
  createIrrigationService,
  type IrrigationService,
} from "../../src/modules/irrigation/irrigation.service";
import { createWeatherService } from "../../src/modules/irrigation/weather/weatherService";
import { makeFarmFixture } from "../fixtures/farm";

const tempDirs: string[] = [];
globalThis.addEventListener("unload", () => {
  for (const d of tempDirs) {
    try {
      Deno.removeSync(d, { recursive: true });
    } catch { /* already gone */ }
  }
});
/** A temp dir for a LibSQL file, removed when the test process exits. */
async function tempDbDir() {
  const d = await Deno.makeTempDir();
  tempDirs.push(d);
  return d;
}

/** Offline Open-Meteo: returns no extra days. Never touches the network. */
export const emptyOpenMeteoFetch: typeof fetch = () =>
  Promise.resolve(Response.json({
    daily: {
      time: [],
      et0_fao_evapotranspiration: [],
      precipitation_sum: [],
      temperature_2m_min: [],
      temperature_2m_mean: [],
    },
  }));

/**
 * The real router on the in-memory farm. Never imports config.ts or supabase.ts.
 * `today` is 2026-07-05.
 */
export function makeTestApp() {
  const data = createMemoryFarmData(makeFarmFixture());
  const weather = createWeatherService({ data, fetch: emptyOpenMeteoFetch });
  const service = createIrrigationService({ data, weather, today: () => "2026-07-05" });
  const app = new Hono();
  app.onError(onError);
  app.route("/irrigation", createIrrigationController(service));
  return { app, data, service };
}

/** A Mastra instance with the advisor workflows on a temp-file LibSQL store. */
export async function makeTestMastra(
  opts: {
    service: IrrigationService;
    data: FarmData;
    // deno-lint-ignore no-explicit-any
    model?: any;
  },
) {
  const workflows = createAdvisorWorkflows(opts.service, opts.data);
  const storage = new LibSQLStore({
    id: "test-store",
    url: `file:${await tempDbDir()}/t.db`,
  });
  return new Mastra({
    storage,
    workflows: {
      "farm-advice": workflows.farmAdvice,
      "simulate-scenario": workflows.simulateScenario,
      "record-irrigation": workflows.recordIrrigation,
      "morning-warmup": workflows.morningWarmup,
    },
    ...(opts.model
      ? {
        agents: {
          [ADVISOR_ID]: createAdvisorAgent({
            service: opts.service,
            data: opts.data,
            model: opts.model,
          }),
        },
      }
      : {}),
  });
}

/**
 * The full app: CORS, /irrigation, GET /chat/history and Mastra (POST /chat, /api/*) on the
 * in-memory farm, the scripted model and a temp LibSQL store. `today` is 2026-07-05.
 */
export async function makeTestChatApp(opts: { model: unknown; openMastraApi?: boolean }) {
  const { app, data, service } = makeTestApp();
  app.use(
    "*",
    cors({ origin: "*", allowHeaders: ["Content-Type", "x-member-id"] }),
  );
  const mastra = createMastra({
    service,
    data,
    // deno-lint-ignore no-explicit-any
    model: opts.model as any,
    openMastraApi: opts.openMastraApi,
    storageUrl: `file:${await tempDbDir()}/chat.db`,
  });
  await mountChat(app, { mastra, service, data });
  return { app, data, service, mastra };
}
