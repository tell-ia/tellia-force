import { HTTPException } from "hono/http-exception";
import type {
  CropRef,
  CropSeason,
  CropStage,
  Farm,
  FarmData,
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
    if (!op) throw new HTTPException(500, { message: `operation ${id} not found` });
    return op;
  };

  return {
    getFarm: async () => f.farm,
    listMembers: async () => f.members,
    getMember: async (id) => f.members.find((m) => m.id === id) ?? null,
    listFields: async () => f.fields,
    getSeasonAt: async (fieldId, date) =>
      (f.seasons[fieldId] ?? []).find((s) => s.sowingDate <= date && date <= s.harvestDate) ??
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

export type { IsoDate };
