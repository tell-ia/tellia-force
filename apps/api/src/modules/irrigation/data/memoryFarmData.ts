import { HTTPException } from "hono/http-exception";
import { notFound } from "./supabaseFarmData";
import type {
  CropRef,
  CropSeason,
  CropStage,
  Farm,
  FarmData,
  FarmDirectory,
  Field,
  IrrigationOperation,
  IsoDate,
  Member,
  NewIrrigation,
  OperationStatus,
  SoilAnalysis,
  StoredWeatherDay,
} from "./farmData";

export interface FarmFixture {
  farm: Farm;
  members: Member[];
  fields: Field[];
  /** Seasons keyed by field id. */
  seasons: Record<number, CropSeason[]>;
  soils: Record<number, SoilAnalysis>;
  cropRefs: CropRef[];
  cropStages: Record<string, CropStage[]>;
  weather: StoredWeatherDay[];
  /** base -> ("MM-DD" -> mean GDD) */
  climatology: Record<number, Record<string, number>>;
  irrigations: IrrigationOperation[];
}

/** In-memory FarmData for tests. Copies the fixture so tests can't leak state. */
export function createMemoryFarmData(fixture: FarmFixture): FarmData {
  const f = structuredClone(fixture);
  const ops = f.irrigations;
  let nextId = Math.max(0, ...ops.map((o) => o.operationId)) + 1;

  const find = (id: number) => {
    const op = ops.find((o) => o.operationId === id);
    if (!op) throw notFound(id);
    return op;
  };

  return {
    getFarm: async () => f.farm,
    listMembers: async () => f.members,
    getMember: async (id) => f.members.find((m) => m.id === id) ?? null,
    listFields: async () => f.fields,
    getSeasonAt: async (fieldId, date) =>
      (f.seasons[fieldId] ?? [])
        .filter((s) => s.sowingDate <= date && date <= s.harvestDate)
        .sort((
          a,
          b,
        ) => (a.sowingDate < b.sowingDate ? 1 : a.sowingDate > b.sowingDate ? -1 : 0))[0] ??
        null,
    getSoil: async (fieldId) => f.soils[fieldId] ?? null,
    getCropRef: async (code) => f.cropRefs.find((c) => c.code === code) ?? null,
    getCropStages: async (code) =>
      [...(f.cropStages[code] ?? [])].sort((a, b) => a.seasonFraction - b.seasonFraction),
    getWeather: async (from, to) =>
      f.weather.filter((d) => d.date >= from && d.date <= to).sort((a, b) =>
        a.date < b.date ? -1 : 1
      ),
    getGddClimatology: async (base) => new Map(Object.entries(f.climatology[base] ?? {})),
    listIrrigations: async (fieldId, opts) =>
      ops.filter((o) => o.fieldId === fieldId && (opts.includeDrafts || o.status !== "draft"))
        .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.operationId - b.operationId)
        .map((o) => ({ ...o })),
    getIrrigation: async (id) => {
      const op = ops.find((o) => o.operationId === id);
      return op ? { ...op } : null;
    },
    createIrrigation: async (input: NewIrrigation) => {
      const op: IrrigationOperation = { ...input, operationId: nextId++ };
      ops.push(op);
      return { ...op };
    },
    setIrrigationStatus: async (id: number, status: OperationStatus) => {
      const op = find(id);
      op.status = status;
      return { ...op };
    },
    deleteIrrigation: async (id) => {
      const i = ops.indexOf(find(id));
      ops.splice(i, 1);
    },
  };
}

/** In-memory FarmDirectory over several fixtures (one per farm). */
export function createMemoryFarmDirectory(fixtures: FarmFixture[]): FarmDirectory {
  const sorted = [...fixtures].sort((a, b) => a.farm.id - b.farm.id);
  const farms = new Map(sorted.map((f) => [f.farm.id, createMemoryFarmData(f)]));
  const memberFarm = new Map(sorted.flatMap((f) => f.members.map((m) => [m.id, f.farm.id])));
  return {
    listFarmIds: () => Promise.resolve([...farms.keys()]),
    farmOfMember: (id) => Promise.resolve(memberFarm.get(id) ?? null),
    defaultMemberId: () =>
      Promise.resolve(sorted[0]?.members.find((m) => m.mainContact)?.id ?? null),
    forFarm: (id) => {
      const data = farms.get(id);
      if (!data) throw new HTTPException(404, { message: `farm ${id} not found` });
      return data;
    },
  };
}

export type { IsoDate };
