// One irrigation scope (data, weather, service) per farm, found from the calling member.
// Each farm gets its own weather service, so caches never mix regions.

import { HTTPException } from "hono/http-exception";
import type { FarmData, FarmDirectory } from "./data/farmData";
import { createIrrigationService, type IrrigationService } from "./irrigation.service";
import { createWeatherService } from "./weather/weatherService";

/** Who is calling (no auth, team decision). Missing = main contact of the first farm. */
export const MEMBER_HEADER = "x-member-id";

export interface FarmScope {
  farmId: number;
  data: FarmData;
  service: IrrigationService;
}

export interface Caller {
  memberId: number;
  scope: FarmScope;
}

export interface FarmRegistry {
  today(): string;
  farmIds(): Promise<number[]>;
  forFarm(farmId: number): Promise<FarmScope>;
  /** The scope of a member's farm, or null when the member does not exist. */
  forMember(memberId: number): Promise<FarmScope | null>;
  /** Resolves the `x-member-id` header; throws HTTPException 400 for an unknown member. */
  resolveCaller(header: string | null | undefined): Promise<Caller>;
}

export function createFarmRegistry(
  deps: {
    directory: FarmDirectory;
    today: () => string;
    /** Open-Meteo fetch, injectable for tests. */
    fetch?: typeof fetch;
    /** Builds a farm's service; tests wrap it with spies. Default createIrrigationService. */
    createService?: typeof createIrrigationService;
  },
): FarmRegistry {
  const { directory, today } = deps;
  const scopes = new Map<number, Promise<FarmScope>>();

  async function build(farmId: number): Promise<FarmScope> {
    const data = directory.forFarm(farmId);
    // Crop names follow the farm's language (its main contact's).
    const members = await data.listMembers();
    const language = (members.find((m) => m.mainContact) ?? members[0])?.language ?? "en";
    const weather = createWeatherService({ data, fetch: deps.fetch });
    const service = (deps.createService ?? createIrrigationService)({
      data,
      weather,
      today,
      language,
    });
    return { farmId, data, service };
  }

  function forFarm(farmId: number): Promise<FarmScope> {
    let p = scopes.get(farmId);
    if (!p) {
      p = build(farmId);
      p.catch(() => scopes.delete(farmId));
      scopes.set(farmId, p);
    }
    return p;
  }

  const unknown = () => new HTTPException(400, { message: "Unknown member" });

  return {
    today,
    farmIds: () => directory.listFarmIds(),
    forFarm,
    async forMember(memberId) {
      const farmId = await directory.farmOfMember(memberId);
      return farmId === null ? null : forFarm(farmId);
    },
    async resolveCaller(header) {
      const h = header?.trim();
      const id = h ? (/^\d+$/.test(h) ? Number(h) : NaN) : await directory.defaultMemberId();
      if (id === null || !Number.isInteger(id)) throw unknown();
      const farmId = await directory.farmOfMember(id);
      if (farmId === null) throw unknown();
      return { memberId: id, scope: await forFarm(farmId) };
    },
  };
}
