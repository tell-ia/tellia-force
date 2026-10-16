import type { SupabaseClient } from "@supabase/supabase-js";
import { HTTPException } from "hono/http-exception";
import type {
  CropRef,
  CropSeason,
  CropStage,
  Farm,
  FarmData,
  FarmDirectory,
  Field,
  IrrigationOperation,
  Member,
  OperationStatus,
  SoilAnalysis,
  StoredWeatherDay,
} from "./farmData";

const PAGE = 1000;

export const notFound = (id: number) =>
  new HTTPException(404, { message: `irrigation operation ${id} not found` });

type Row = Record<string, unknown>;

// ---- pure row mappers (snake_case -> camelCase), unit-tested ----

export function mapFarm(r: Row): Farm {
  return { id: r.id as number, name: r.name as string, lat: r.lat as number, lon: r.lon as number };
}

export function mapMember(r: Row): Member {
  return {
    id: r.id as number,
    name: r.full_name as string,
    language: r.language as string,
    mainContact: r.main_contact as boolean,
  };
}

export function mapField(r: Row): Field {
  const lat = r.centroid_lat as number | null;
  const lon = r.centroid_lon as number | null;
  return {
    id: r.id as number,
    name: r.name as string,
    areaHa: r.area_ha as number,
    irrigable: r.irrigable as boolean,
    centroid: lat != null && lon != null ? { lat, lon } : null,
  };
}

export function mapCropSeason(r: Row): CropSeason {
  return {
    id: r.id as number,
    cropCode: r.crop_code as string,
    sowingDate: r.sowing_date as string,
    harvestDate: r.harvest_date as string,
    status: r.status as string,
  };
}

export function mapSoil(r: Row): SoilAnalysis {
  return {
    sandPct: r.sand_pct as number,
    clayPct: r.clay_pct as number,
    organicMatterPct: r.organic_matter_pct as number,
  };
}

const NAME_LANGS = ["fr", "en", "es", "de", "it", "pt"] as const;

export function mapCropRef(r: Row): CropRef {
  const names: Record<string, string> = {};
  for (const lang of NAME_LANGS) {
    const name = r[`name_${lang}`];
    if (typeof name === "string" && name) names[lang] = name;
  }
  return {
    code: r.crop_code as string,
    nameFr: r.name_fr as string,
    nameEn: r.name_en as string,
    names,
    gddBaseC: r.gdd_base_c as number,
    kcIni: r.kc_ini as number,
    kcMid: r.kc_mid as number,
    kcEnd: r.kc_end as number,
  };
}

export function mapCropStage(r: Row): CropStage {
  return {
    seasonFraction: r.season_fraction as number,
    kc: r.kc as number,
    label: (r.label_en as string | undefined) ?? null,
    bbch: (r.bbch as number | undefined) ?? null,
  };
}

export function mapWeatherDay(r: Row): StoredWeatherDay {
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    date: r.date as string,
    et0: Number(r.et0_mm ?? 0),
    rain: Number(r.precip_mm ?? 0),
    tmin: Number(r.tmin_c ?? 0),
    tmean: Number(r.tmean_c ?? 0),
    gddBase0: n(r.gdd_base0),
    gddBase5: n(r.gdd_base5),
    gddBase6: n(r.gdd_base6),
    gddBase10: n(r.gdd_base10),
  };
}

export function mapOperation(r: Row): IrrigationOperation {
  return {
    operationId: r.id as number,
    fieldId: r.field_id as number,
    seasonId: (r.crop_season_id as number | null) ?? null,
    date: r.op_date as string,
    mm: r.water_mm as number,
    status: r.status as OperationStatus,
    source: r.source as string,
    memberId: (r.member_id as number | null) ?? null,
  };
}

/** Feb 29 folds into Feb 28 for climatology keys. */
export function climatologyKey(date: string): string {
  const k = date.slice(5, 10);
  return k === "02-29" ? "02-28" : k;
}

/** Mean per "MM-DD" of the given (date, value) pairs; Feb 29 folds into Feb 28. */
export function averageByDay(rows: { date: string; value: number | null }[]): Map<string, number> {
  const acc = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    if (r.value == null) continue;
    const k = climatologyKey(r.date);
    const a = acc.get(k) ?? { sum: 0, n: 0 };
    a.sum += r.value;
    a.n++;
    acc.set(k, a);
  }
  return new Map([...acc].map(([k, a]) => [k, a.sum / a.n]));
}

/** Row to insert for a new irrigation. Only what the DB cannot default. */
export function toOperationInsert(
  input: {
    fieldId: number;
    seasonId: number;
    date: string;
    mm: number;
    status: OperationStatus;
    source: string;
    memberId: number | null;
  },
  areaHa: number | null,
): Row {
  return {
    field_id: input.fieldId,
    crop_season_id: input.seasonId,
    op_date: input.date,
    op_type: "irrigation",
    water_mm: input.mm,
    status: input.status,
    source: input.source,
    origin: input.source === "app" ? "app" : "assistant",
    member_id: input.memberId,
    area_ha: areaHa,
  };
}

type Result = { data: unknown; error: { message: string } | null };

const fail = (message: string): never => {
  throw new HTTPException(500, { message });
};

async function rows(q: PromiseLike<Result>): Promise<Row[]> {
  const { data, error } = await q;
  if (error) fail(error.message);
  return (data ?? []) as Row[];
}

async function paged(build: (from: number, to: number) => PromiseLike<Result>): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0;; from += PAGE) {
    const page = await rows(build(from, from + PAGE - 1));
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

async function one(q: PromiseLike<Result>): Promise<Row | null> {
  const r = await rows(q);
  return r[0] ?? null;
}

/**
 * Supabase FarmData for one farm. Every farm table is filtered on `farm_id`; weather comes
 * from the farm's region (`nuts3_id`). Crop reference tables are shared by all farms.
 */
export function createSupabaseFarmData(db: SupabaseClient, farmId: number): FarmData {
  const climCache = new Map<number, Promise<Map<string, number>>>();

  let farmP: Promise<Row> | null = null;
  function farmRow(): Promise<Row> {
    if (!farmP) {
      farmP = one(db.from("farm").select("*").eq("id", farmId).limit(1)).then((r) =>
        r ?? fail(`farm ${farmId} not found`)
      );
      farmP.catch(() => (farmP = null));
    }
    return farmP;
  }
  const irrigationOps = () =>
    db.from("operation").select("*").eq("farm_id", farmId).eq("op_type", "irrigation")
      .not("water_mm", "is", null);

  return {
    async getFarm() {
      return mapFarm(await farmRow());
    },
    async listMembers() {
      return (await rows(db.from("member").select("*").eq("farm_id", farmId).order("id")))
        .map(mapMember);
    },
    async getMember(id) {
      const r = await one(
        db.from("member").select("*").eq("id", id).eq("farm_id", farmId).limit(1),
      );
      return r ? mapMember(r) : null;
    },
    async listFields() {
      return (await rows(db.from("field").select("*").eq("farm_id", farmId).order("id")))
        .map(mapField);
    },
    async getSeasonAt(fieldId, date) {
      const r = await one(
        db.from("crop_season").select("*").eq("farm_id", farmId).eq("field_id", fieldId)
          .lte("sowing_date", date).gte("harvest_date", date)
          .order("sowing_date", { ascending: false }).limit(1),
      );
      return r ? mapCropSeason(r) : null;
    },
    async getSoil(fieldId) {
      const r = await one(
        db.from("soil_analysis").select("*").eq("farm_id", farmId).eq("field_id", fieldId)
          .order("sampled_on", { ascending: false, nullsFirst: false }).limit(1),
      );
      return r ? mapSoil(r) : null;
    },
    async getCropRef(code) {
      const r = await one(db.from("crop_ref").select("*").eq("crop_code", code).limit(1));
      return r ? mapCropRef(r) : null;
    },
    async getCropStages(code) {
      const r = await rows(
        db.from("crop_stage").select("*").eq("crop_code", code).order("season_fraction"),
      );
      return r.map(mapCropStage);
    },
    async getWeather(from, to) {
      const region = (await farmRow()).nuts3_id;
      const r = await paged((a, b) =>
        db.from("weather_daily").select("*").eq("nuts3_id", region).gte("date", from)
          .lte("date", to).order("date").range(a, b)
      );
      return r.map(mapWeatherDay);
    },
    getGddClimatology(base) {
      let p = climCache.get(base);
      if (!p) {
        const col = `gdd_base${base}`;
        p = farmRow().then((farm) =>
          paged((a, b) =>
            db.from("weather_daily").select(`date,${col}`).eq("nuts3_id", farm.nuts3_id)
              .gte("date", "2015-01-01").lte("date", "2024-12-31")
              .order("date").range(a, b)
          )
        ).then((r) =>
          averageByDay(r.map((x) => ({ date: x.date as string, value: x[col] as number | null })))
        );
        p.catch(() => climCache.delete(base));
        climCache.set(base, p);
      }
      return p;
    },
    async listIrrigations(fieldId, opts) {
      let q = irrigationOps().eq("field_id", fieldId);
      if (!opts.includeDrafts) q = q.neq("status", "draft");
      return (await rows(q.order("op_date").order("id"))).map(mapOperation);
    },
    async getIrrigation(operationId) {
      const r = await one(irrigationOps().eq("id", operationId).limit(1));
      return r ? mapOperation(r) : null;
    },
    async createIrrigation(input) {
      // farm_id is filled by a DB trigger from the field; the field must belong to this farm.
      const field = await one(
        db.from("field").select("area_ha").eq("id", input.fieldId).eq("farm_id", farmId).limit(1),
      );
      if (!field) throw new HTTPException(404, { message: `field ${input.fieldId} not found` });
      const r = await one(
        db.from("operation").insert(
          toOperationInsert(input, (field.area_ha as number | undefined) ?? null),
        ).select("*"),
      );
      if (!r) fail("insert returned no row");
      return mapOperation(r!);
    },
    async setIrrigationStatus(operationId, status) {
      const r = await one(
        db.from("operation").update({ status, updated_at: new Date().toISOString() })
          .eq("id", operationId).eq("farm_id", farmId).eq("op_type", "irrigation").select("*"),
      );
      if (!r) throw notFound(operationId);
      return mapOperation(r);
    },
    async deleteIrrigation(operationId) {
      const r = await rows(
        db.from("operation").delete().eq("id", operationId).eq("farm_id", farmId)
          .eq("op_type", "irrigation").select("id"),
      );
      if (r.length === 0) throw notFound(operationId);
    },
  };
}

/** Farm lookups across the shared database, plus one cached FarmData per farm. */
export function createSupabaseFarmDirectory(db: SupabaseClient): FarmDirectory {
  const perFarm = new Map<number, FarmData>();
  return {
    async listFarmIds() {
      return (await rows(db.from("farm").select("id").order("id"))).map((r) => r.id as number);
    },
    async farmOfMember(memberId) {
      const r = await one(db.from("member").select("farm_id").eq("id", memberId).limit(1));
      return r ? (r.farm_id as number) : null;
    },
    async defaultMemberId() {
      const farm = await one(db.from("farm").select("id").order("id").limit(1));
      if (!farm) return null;
      const r = await one(
        db.from("member").select("id").eq("farm_id", farm.id).eq("main_contact", true)
          .order("id").limit(1),
      );
      return r ? (r.id as number) : null;
    },
    forFarm(farmId) {
      let data = perFarm.get(farmId);
      if (!data) {
        data = createSupabaseFarmData(db, farmId);
        perFarm.set(farmId, data);
      }
      return data;
    },
  };
}
