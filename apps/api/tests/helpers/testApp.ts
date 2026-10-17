import { cors } from "hono/cors";
import { createMastra, mountChat } from "../../src/modules/chat/mastra";
import { Mastra } from "@mastra/core";
import { InMemoryStore } from "@mastra/core/storage";
import { Hono } from "hono";
import { ADVISOR_ID, createAdvisorAgent } from "../../src/modules/chat/advisor.agent";
import { createAdvisorWorkflows } from "../../src/modules/chat/workflows/index";
import type { FarmData, FarmDirectory } from "../../src/modules/irrigation/data/farmData";
import { onError } from "../../src/core/middleware";
import { createMemoryFarmData } from "../../src/modules/irrigation/data/memoryFarmData";
import { createIrrigationController } from "../../src/modules/irrigation/irrigation.controller";
import { HTTPException } from "hono/http-exception";
import {
  createIrrigationService,
  type IrrigationService,
} from "../../src/modules/irrigation/irrigation.service";
import { createFarmRegistry, type FarmRegistry } from "../../src/modules/irrigation/farmRegistry";
import { makeFarmFixture, makeSecondFarmFixture } from "../fixtures/farm";

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

export const TEST_TODAY = "2026-07-05";

/** A FarmDirectory over prebuilt FarmData, keyed by farm id (tests may wrap them). */
export function directoryOf(farms: Record<number, FarmData>): FarmDirectory {
  const ids = Object.keys(farms).map(Number).sort((a, b) => a - b);
  const farmOfMember = async (memberId: number) => {
    for (const id of ids) if (await farms[id].getMember(memberId)) return id;
    return null;
  };
  return {
    listFarmIds: () => Promise.resolve(ids),
    farmOfMember,
    defaultMemberId: async () =>
      ids.length
        ? (await farms[ids[0]].listMembers()).find((m) => m.mainContact)?.id ?? null
        : null,
    forFarm: (id) => {
      const data = farms[id];
      if (!data) throw new HTTPException(404, { message: `farm ${id} not found` });
      return data;
    },
  };
}

/** Default test farms: 1 (Loiret, fr) and 2 (Valladolid, es). */
export const twoFarms = (): Record<number, FarmData> => ({
  1: createMemoryFarmData(makeFarmFixture()),
  2: createMemoryFarmData(makeSecondFarmFixture()),
});

/** The real FarmRegistry over in-memory farms, offline Open-Meteo, `today` 2026-07-05. */
export function makeTestRegistry(
  opts: {
    farms?: Record<number, FarmData>;
    /** Wrap a farm's service (spies, failures). */
    wrap?: (service: IrrigationService, farmId: number) => IrrigationService;
    /** Default: always TEST_TODAY. */
    today?: () => string;
  } = {},
): FarmRegistry {
  const farms = opts.farms ?? twoFarms();
  const farmIdOf = new Map(Object.entries(farms).map(([id, d]) => [d, Number(id)]));
  return createFarmRegistry({
    directory: directoryOf(farms),
    today: opts.today ?? (() => TEST_TODAY),
    fetch: emptyOpenMeteoFetch,
    createService: (deps) => {
      const service = createIrrigationService(deps);
      return opts.wrap ? opts.wrap(service, farmIdOf.get(deps.data) ?? 0) : service;
    },
  });
}

/**
 * The real /irrigation router on two in-memory farms. Never imports config.ts or supabase.ts.
 * `data` and `service` are farm 1's (the default caller's farm).
 */
export async function makeTestApp(opts: Parameters<typeof makeTestRegistry>[0] = {}) {
  const registry = makeTestRegistry(opts);
  const app = new Hono();
  app.onError(onError);
  app.route("/irrigation", createIrrigationController(registry));
  const { data, service } = await registry.forFarm(1);
  return { app, registry, data, service };
}

/**
 * A Mastra instance with the advisor workflows (and agent, given a model) on in-memory storage.
 * Not LibSQL: its native addon can segfault when the garbage collector finalizes its objects,
 * which crashed whole test files at random. makeTestChatApp keeps LibSQL (the real setup).
 */
export async function makeTestMastra(
  opts: {
    registry: FarmRegistry;
    // deno-lint-ignore no-explicit-any
    model?: any;
  },
) {
  const workflows = createAdvisorWorkflows(opts.registry);
  const storage = new InMemoryStore({ id: "test-store" });
  return new Mastra({
    storage,
    workflows: {
      "farm-advice": workflows.farmAdvice,
      "simulate-scenario": workflows.simulateScenario,
      "record-irrigation": workflows.recordIrrigation,
      "correct-irrigation": workflows.correctIrrigation,
      "morning-warmup": workflows.morningWarmup,
    },
    ...(opts.model
      ? {
        agents: {
          [ADVISOR_ID]: createAdvisorAgent({ registry: opts.registry, model: opts.model }),
        },
      }
      : {}),
  });
}

/**
 * The full app: CORS, /irrigation, GET /chat/history and Mastra (POST /chat, /api/*) on two
 * in-memory farms, the scripted model and a temp LibSQL store. `today` is 2026-07-05.
 */
export async function makeTestChatApp(
  opts: { model: unknown; openMastraApi?: boolean; farms?: Record<number, FarmData> },
) {
  const { app, registry, data, service } = await makeTestApp({ farms: opts.farms });
  app.use(
    "*",
    cors({ origin: "*", allowHeaders: ["Content-Type", "x-member-id"] }),
  );
  const mastra = createMastra({
    registry,
    // deno-lint-ignore no-explicit-any
    model: opts.model as any,
    openMastraApi: opts.openMastraApi,
    storageUrl: `file:${await tempDbDir()}/chat.db`,
  });
  await mountChat(app, { mastra, registry });
  return { app, registry, data, service, mastra };
}
