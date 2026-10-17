import type { SupabaseClient } from "@supabase/supabase-js";
import { HTTPException } from "hono/http-exception";
import type { CropParams } from "../engine/cropModel";
import type { SoilWaterClass } from "../engine/soil";
import type { CropKy } from "../engine/waterTarget";
import type {
  CropPhaseRow,
  CropRef,
  CropSeason,
  CropStage,
  Farm,
  FarmData,
  FarmDirectory,
  FarmEconomicsRecord,
  FarmOperation,
  Field,
  IrrigationChange,
  IrrigationOperation,
  IrrigationSystem,
  MarketPriceRecord,
  Member,
  OperationProduct,
  OperationSource,
  OperationStatus,
  OperationType,
  Product,
  ProductUse,
  RegionalBenchmarkRecord,
  SaleRecord,
  SoilAnalysis,
  StoredWeatherDay,
  SubsidyRecord,
} from "./farmData";
import { pickCropPhases } from "./farmData";

const PAGE = 1000;
// Farm tables only the seed writes (fields, seasons, soils, irrigation systems): one farm-wide
// read, shared this long, then filtered in memory. A farm advice reads every field at once:
// per-field queries were ~44 round trips, ~5 deep (~1 s); the time is the network, not the DB.
const FARM_TABLE_TTL_MS = 60_000;
// Irrigation operations change through this API: shared just long enough to serve one request's
// per-field reads with one query, and dropped on every write.
const IRRIGATIONS_TTL_MS = 2_000;

export const notFound = (id: number) =>
  new HTTPException(404, { message: `irrigation operation ${id} not found` });

type Row = Record<string, unknown>;

/** A numeric column as a number; null stays null. */
const num = (v: unknown) => (v == null ? null : Number(v));
/** A text column as a string; null stays null. */
const str = (v: unknown) => (v == null ? null : String(v));

// ---- pure row mappers (snake_case -> camelCase), unit-tested ----

/** The farm row, plus the aridity of its region (`region` row) when we have it. */
export function mapFarm(r: Row, region: Row | null = null): Farm {
  return {
    id: r.id as number,
    name: r.name as string,
    lat: r.lat as number,
    lon: r.lon as number,
    aridityIndex: aridityIndex(region),
    countryCode: str(r.country_code),
  };
}

/** Region mean annual precipitation / mean annual ET0, or null when a value is missing. */
export function aridityIndex(region: Row | null): number | null {
  const precip = num(region?.mean_annual_precip_mm);
  const et0 = num(region?.mean_annual_et0_mm);
  return precip != null && et0 ? precip / et0 : null;
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
    tenure: str(r.tenure),
  };
}

export function mapCropSeason(r: Row): CropSeason {
  const season: CropSeason = {
    id: r.id as number,
    cropCode: r.crop_code as string,
    sowingDate: r.sowing_date as string,
    harvestDate: r.harvest_date as string,
    status: r.status as string,
  };
  // Only when the row has the column (a DB without it keeps the old shape).
  if ("earliness_group" in r) season.earlinessGroup = (r.earliness_group as string | null) ?? null;
  if ("variety" in r) season.variety = str(r.variety);
  if ("previous_crop_code" in r) season.previousCropCode = str(r.previous_crop_code);
  return season;
}

export function mapSoil(r: Row): SoilAnalysis {
  return {
    sandPct: r.sand_pct as number,
    clayPct: r.clay_pct as number,
    organicMatterPct: r.organic_matter_pct as number,
    sampledOn: str(r.sampled_on),
    siltPct: num(r.silt_pct),
    ph: num(r.ph_h2o),
    nitrogenGKg: num(r.nitrogen_g_kg),
    phosphorusMgKg: num(r.phosphorus_mg_kg),
    potassiumMgKg: num(r.potassium_mg_kg),
    sulfurMgKg: num(r.sulfur_mg_kg),
    calciumMgKg: num(r.calcium_mg_kg),
    magnesiumMgKg: num(r.magnesium_mg_kg),
    zincMgKg: num(r.zinc_mg_kg),
    boronMgKg: num(r.boron_mg_kg),
    cecCmolKg: num(r.cec_cmol_kg),
    bulkDensityKgDm3: num(r.bulk_density_kg_dm3),
    limeRequirementTHa: num(r.lime_requirement_t_ha),
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
    cropGroupCode: str(r.crop_group_code),
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
    tmax: n(r.tmax_c),
    gddBase0: n(r.gdd_base0),
    gddBase5: n(r.gdd_base5),
    gddBase6: n(r.gdd_base6),
    gddBase10: n(r.gdd_base10),
  };
}

/**
 * FAO-56 values of one crop from its rows in fao56_crop_stages, fao56_kc and
 * fao56_root_depletion. Null when a row or a value is missing (only the Tmax cap may be empty).
 */
export function mapCropParams(
  stages: Row | null,
  kc: Row | null,
  roots: Row | null,
): CropParams | null {
  if (!stages || !kc || !roots) return null;
  const values = [
    stages.t_base_c,
    kc.kc_ini,
    kc.kc_mid,
    kc.kc_end,
    roots.zr_ini_m,
    roots.zr_max_default_m,
    roots.p_table,
  ].map(num);
  if (values.some((v) => v == null || Number.isNaN(v))) return null;
  const [tBaseC, kcIni, kcMid, kcEnd, zrIniM, zrMaxM, pTable] = values as number[];
  return { tBaseC, tMaxCapC: num(stages.t_max_cap_c), kcIni, kcMid, kcEnd, zrIniM, zrMaxM, pTable };
}

/** One fao33_ky row. Null when the crop has no FAO value for any period (rapeseed, olive). */
export function mapCropKy(r: Row | null): CropKy | null {
  if (!r) return null;
  const ky: CropKy = {
    vegetative: num(r.ky_vegetative),
    flowering: num(r.ky_flowering),
    yieldFormation: num(r.ky_yield_formation),
    ripening: num(r.ky_ripening),
  };
  return Object.values(ky).every((v) => v === null) ? null : ky;
}

/** One crop_phase_gdd row. The sensitive window needs all three of from, to and p. */
export function mapCropPhaseRow(r: Row): CropPhaseRow {
  const from = num(r.sensitive_from);
  const to = num(r.sensitive_to);
  const p = num(r.sensitive_p);
  return {
    cropCode: r.crop_code as string,
    earlinessGroup: (r.earliness_group as string | null | undefined) ?? null,
    phases: {
      iniEnd: Number(r.ini_end),
      devEnd: Number(r.dev_end),
      midEnd: Number(r.mid_end),
      lateEnd: Number(r.late_end),
      flowering: num(r.flowering),
      sensitive: from != null && to != null && p != null ? { from, to, p } : null,
    },
    method: (r.method as string | null | undefined) ?? null,
  };
}

/** One fao56_soil_water row (mid values), or null when a θ is missing. */
export function mapSoilWaterClass(r: Row): SoilWaterClass | null {
  const thetaFcMid = num(r.theta_fc_mid);
  const thetaWpMid = num(r.theta_wp_mid);
  if (thetaFcMid == null || thetaWpMid == null) return null;
  return { textureClass: r.texture_class_usda as string, thetaFcMid, thetaWpMid };
}

export function mapIrrigationSystem(r: Row): IrrigationSystem {
  return {
    id: r.id as number,
    name: r.name as string,
    type: str(r.system_type),
    efficiency: Number(r.efficiency),
    doseMinMm: num(r.dose_min_mm),
    doseMaxMm: num(r.dose_max_mm),
    roundDays: num(r.round_days),
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
    source: r.source as OperationSource,
    memberId: (r.member_id as number | null) ?? null,
  };
}

/** Columns read for the journal: the operation and its products (PostgREST embed). */
export const JOURNAL_SELECT =
  "id,field_id,crop_season_id,op_date,op_type,status,bbch,fertiliser_type,n_kg_ha,p2o5_kg_ha," +
  "k2o_kg_ha,method,water_mm,variety,seed_rate_kg_ha,yield_t_ha,moisture_pct,protein_pct,notes," +
  "operation_input(product_id,product_name,dose,dose_unit,target)";

export function mapOperationProduct(r: Row): OperationProduct {
  return {
    productId: num(r.product_id),
    productName: r.product_name as string,
    dose: num(r.dose),
    doseUnit: str(r.dose_unit),
    target: str(r.target),
  };
}

/** One journal row with its embedded `operation_input` rows. */
export function mapFarmOperation(r: Row): FarmOperation {
  return {
    operationId: Number(r.id),
    fieldId: r.field_id as number,
    seasonId: num(r.crop_season_id),
    date: r.op_date as string,
    type: r.op_type as OperationType,
    status: r.status as FarmOperation["status"],
    bbch: num(r.bbch),
    fertiliserType: str(r.fertiliser_type),
    nKgHa: num(r.n_kg_ha),
    p2o5KgHa: num(r.p2o5_kg_ha),
    k2oKgHa: num(r.k2o_kg_ha),
    waterMm: num(r.water_mm),
    variety: str(r.variety),
    seedRateKgHa: num(r.seed_rate_kg_ha),
    yieldTHa: num(r.yield_t_ha),
    moisturePct: num(r.moisture_pct),
    proteinPct: num(r.protein_pct),
    method: str(r.method),
    notes: str(r.notes),
    products: ((r.operation_input as Row[] | null | undefined) ?? []).map(mapOperationProduct),
  };
}

/** Columns read from the E-Phy catalogue. */
export const PRODUCT_SELECT = "id,name,amm_number,product_kind,active_substances";
/** Columns read from the E-Phy uses. */
export const PRODUCT_USE_SELECT =
  "product_id,crop_code,target,max_dose,dose_unit,max_applications,pre_harvest_interval_days," +
  "bbch_min,bbch_max,buffer_zone_water_m,conditions";

export function mapProduct(r: Row): Product {
  return {
    id: Number(r.id),
    name: r.name as string,
    ammNumber: str(r.amm_number),
    kind: str(r.product_kind),
    activeSubstances: str(r.active_substances),
  };
}

export function mapProductUse(r: Row): ProductUse {
  return {
    productId: Number(r.product_id),
    cropCode: r.crop_code as string,
    target: str(r.target),
    maxDose: num(r.max_dose),
    doseUnit: str(r.dose_unit),
    maxApplications: num(r.max_applications),
    preHarvestIntervalDays: num(r.pre_harvest_interval_days),
    bbchMin: num(r.bbch_min),
    bbchMax: num(r.bbch_max),
    bufferZoneWaterM: num(r.buffer_zone_water_m),
    conditions: str(r.conditions),
  };
}

// ---- business tables of the farm data lookup ----

export const SALE_SELECT =
  "id,sale_date,crop_code,harvest_year,volume_t,price_eur_t,buyer,contract_type,quality_grade";
export const MARKET_PRICE_SELECT = "crop_code,year,month,price_eur_t";
export const SUBSIDY_SELECT = "id,year,scheme,amount_eur";
export const FARM_ECONOMICS_SELECT =
  "year,total_output_eur,seeds_eur,fertiliser_eur,crop_protection_eur,energy_eur," +
  "contract_work_eur,wages_eur,depreciation_eur,total_inputs_eur,farm_net_value_added_eur";
export const REGIONAL_BENCHMARK_SELECT =
  "crop_group_code,crop_group_name,year,yield_t_ha,yield_source_geography,yield_value_type," +
  "n_kg_ha,p2o5_kg_ha,k2o_kg_ha,npk_reference_year,irrigated_share,pesticide_total_kg_ai_ha," +
  "herbicide_kg_ai_ha,fungicide_kg_ai_ha,insecticide_kg_ai_ha,pesticide_reference";

export function mapSale(r: Row): SaleRecord {
  return {
    id: Number(r.id),
    date: r.sale_date as string,
    cropCode: r.crop_code as string,
    harvestYear: Number(r.harvest_year),
    volumeT: Number(r.volume_t),
    priceEurT: Number(r.price_eur_t),
    buyer: str(r.buyer),
    contractType: str(r.contract_type),
    qualityGrade: str(r.quality_grade),
  };
}

export function mapMarketPrice(r: Row): MarketPriceRecord {
  return {
    cropCode: r.crop_code as string,
    year: Number(r.year),
    month: Number(r.month),
    priceEurT: Number(r.price_eur_t),
  };
}

export function mapSubsidy(r: Row): SubsidyRecord {
  return {
    id: Number(r.id),
    year: Number(r.year),
    scheme: r.scheme as string,
    amountEur: Number(r.amount_eur),
  };
}

export function mapFarmEconomics(r: Row): FarmEconomicsRecord {
  return {
    year: Number(r.year),
    totalOutputEur: num(r.total_output_eur),
    seedsEur: num(r.seeds_eur),
    fertiliserEur: num(r.fertiliser_eur),
    cropProtectionEur: num(r.crop_protection_eur),
    energyEur: num(r.energy_eur),
    contractWorkEur: num(r.contract_work_eur),
    wagesEur: num(r.wages_eur),
    depreciationEur: num(r.depreciation_eur),
    totalInputsEur: num(r.total_inputs_eur),
    farmNetValueAddedEur: num(r.farm_net_value_added_eur),
  };
}

export function mapRegionalBenchmark(r: Row): RegionalBenchmarkRecord {
  return {
    cropGroupCode: r.crop_group_code as string,
    cropGroupName: str(r.crop_group_name),
    year: Number(r.year),
    yieldTHa: num(r.yield_t_ha),
    yieldSourceGeography: str(r.yield_source_geography),
    yieldValueType: str(r.yield_value_type),
    nKgHa: num(r.n_kg_ha),
    p2o5KgHa: num(r.p2o5_kg_ha),
    k2oKgHa: num(r.k2o_kg_ha),
    npkReferenceYear: num(r.npk_reference_year),
    irrigatedShare: num(r.irrigated_share),
    pesticideTotalKgAiHa: num(r.pesticide_total_kg_ai_ha),
    herbicideKgAiHa: num(r.herbicide_kg_ai_ha),
    fungicideKgAiHa: num(r.fungicide_kg_ai_ha),
    insecticideKgAiHa: num(r.insecticide_kg_ai_ha),
    pesticideReference: str(r.pesticide_reference),
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
    source: OperationSource;
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
    origin: input.source === "web" ? "app" : "assistant",
    member_id: input.memberId,
    area_ha: areaHa,
  };
}

/**
 * Columns a correction changes on an irrigation row, with its `updated_at`. A new date clears
 * `bbch`: the stage the import stored was the crop stage of the old date.
 */
export function toOperationUpdate(change: IrrigationChange, now: Date): Row {
  return {
    op_date: change.date,
    water_mm: change.mm,
    crop_season_id: change.seasonId,
    ...(change.dateChanged ? { bbch: null } : {}),
    updated_at: now.toISOString(),
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
 *
 * The FAO-56 reads (reference tables, region aridity, irrigation system) are optional: when a
 * table is missing (crop_phase_gdd is not in every DB yet) or the query fails, they log one
 * warning and return null / [], so the service falls back to the old model instead of failing.
 */
export function createSupabaseFarmData(db: SupabaseClient, farmId: number): FarmData {
  const climCache = new Map<number, Promise<Map<string, number>>>();
  // Reference tables never change while the API runs: read each one once.
  const refCache = new Map<string, Promise<unknown[]>>();
  const warned = new Set<string>();

  function warnOnce(what: string, e: unknown) {
    if (warned.has(what)) return;
    warned.add(what);
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`irrigation: cannot read ${what}, falling back to defaults (${message})`);
  }

  /** A whole reference table, cached. A failure gives [] and is retried on the next call. */
  function reference<T>(table: string, columns: string, map: (r: Row[]) => T[]): Promise<T[]> {
    let p = refCache.get(table) as Promise<T[]> | undefined;
    if (!p) {
      p = rows(db.from(table).select(columns)).then(map).catch((e) => {
        refCache.delete(table);
        warnOnce(table, e);
        return [];
      });
      refCache.set(table, p);
    }
    return p;
  }

  let regionP: Promise<Row | null> | null = null;
  function regionRow(farm: Row): Promise<Row | null> {
    if (!regionP) {
      regionP = one(
        db.from("region").select("mean_annual_precip_mm,mean_annual_et0_mm")
          .eq("nuts3_id", farm.nuts3_id).limit(1),
      ).catch((e) => {
        regionP = null;
        warnOnce("region", e);
        return null;
      });
    }
    return regionP;
  }

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
  // The catalogue never changes while the API runs. Unlike `reference`, a failure throws:
  // an empty catalogue would wrongly answer "no such product".
  let productsP: Promise<Product[]> | null = null;
  // Same for the crops: an empty list would wrongly answer "unknown crop".
  let cropRefsP: Promise<CropRef[]> | null = null;
  function cropRefs(): Promise<CropRef[]> {
    if (!cropRefsP) {
      cropRefsP = rows(db.from("crop_ref").select("*").order("crop_code")).then((r) =>
        r.map(mapCropRef)
      );
      cropRefsP.catch(() => (cropRefsP = null));
    }
    return cropRefsP;
  }

  const irrigationOps = () =>
    db.from("operation").select("*").eq("farm_id", farmId).eq("op_type", "irrigation")
      .not("water_mm", "is", null);

  /** A farm-wide read shared for `ttlMs` (concurrent callers share the promise). Failures are evicted. */
  const farmWide = new Map<string, { at: number; value: Promise<Row[]> }>();
  function shared(key: string, ttlMs: number, load: () => Promise<Row[]>): Promise<Row[]> {
    const hit = farmWide.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = load();
    farmWide.set(key, { at: Date.now(), value });
    value.catch(() => {
      if (farmWide.get(key)?.value === value) farmWide.delete(key);
    });
    return value;
  }
  const fieldRows = () =>
    shared(
      "field",
      FARM_TABLE_TTL_MS,
      () => rows(db.from("field").select("*").eq("farm_id", farmId).order("id")),
    );
  // Newest sowing first, as getSeasonAt picks.
  const seasonRows = () =>
    shared(
      "crop_season",
      FARM_TABLE_TTL_MS,
      () =>
        paged((a, b) =>
          db.from("crop_season").select("*").eq("farm_id", farmId)
            .order("sowing_date", { ascending: false }).order("id").range(a, b)
        ),
    );
  // Newest sample first, undated last, as getSoil picks.
  const soilRows = () =>
    shared("soil_analysis", FARM_TABLE_TTL_MS, () =>
      rows(
        db.from("soil_analysis").select("*").eq("farm_id", farmId)
          .order("sampled_on", { ascending: false, nullsFirst: false }).order("id"),
      ));
  const systemRows = () =>
    shared(
      "irrigation_system",
      FARM_TABLE_TTL_MS,
      () => rows(db.from("irrigation_system").select("*").eq("farm_id", farmId)),
    );
  const irrigationRows = () =>
    shared(
      "irrigations",
      IRRIGATIONS_TTL_MS,
      () => paged((a, b) => irrigationOps().order("op_date").order("id").range(a, b)),
    );
  /** After a write: the next read sees it. */
  const irrigationsChanged = () => farmWide.delete("irrigations");

  return {
    async getFarm() {
      const farm = await farmRow();
      return mapFarm(farm, await regionRow(farm));
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
      return (await fieldRows()).map(mapField);
    },
    async getSeasonAt(fieldId, date) {
      const r = (await seasonRows()).find((s) =>
        s.field_id === fieldId && typeof s.sowing_date === "string" &&
        typeof s.harvest_date === "string" && s.sowing_date <= date && s.harvest_date >= date
      );
      return r ? mapCropSeason(r) : null;
    },
    async getSoil(fieldId) {
      const r = (await soilRows()).find((s) => s.field_id === fieldId);
      return r ? mapSoil(r) : null;
    },
    async getCropRef(code) {
      return (await cropRefs()).find((c) => c.code === code) ?? null;
    },
    async getCropStages(code) {
      const r = await rows(
        db.from("crop_stage").select("*").eq("crop_code", code).order("season_fraction"),
      );
      return r.map(mapCropStage);
    },
    async getCropParams(code) {
      const [stages, kc, roots] = await Promise.all([
        reference("fao56_crop_stages", "crop_code,t_base_c,t_max_cap_c", (r) => r),
        reference("fao56_kc", "crop_code,kc_ini,kc_mid,kc_end", (r) => r),
        reference("fao56_root_depletion", "crop_code,zr_ini_m,zr_max_default_m,p_table", (r) => r),
      ]);
      const ofCrop = (table: Row[]) => table.find((r) => r.crop_code === code) ?? null;
      return mapCropParams(ofCrop(stages), ofCrop(kc), ofCrop(roots));
    },
    async getCropKy(code) {
      const all = await reference(
        "fao33_ky",
        "crop_code,ky_vegetative,ky_flowering,ky_yield_formation,ky_ripening",
        (r) => r,
      );
      return mapCropKy(all.find((r) => r.crop_code === code) ?? null);
    },
    async getCropPhases(code, earlinessGroup) {
      const all = await reference("crop_phase_gdd", "*", (r) => r.map(mapCropPhaseRow));
      return pickCropPhases(all, code, earlinessGroup);
    },
    getSoilWaterClasses() {
      return reference(
        "fao56_soil_water",
        "texture_class_usda,theta_fc_mid,theta_wp_mid",
        (r) => r.map(mapSoilWaterClass).filter((c) => c != null),
      );
    },
    async getIrrigationSystem(fieldId) {
      try {
        const field = (await fieldRows()).find((f) => f.id === fieldId);
        if (field?.irrigation_system_id == null) return null;
        const r = (await systemRows()).find((s) => s.id === field.irrigation_system_id);
        return r ? mapIrrigationSystem(r) : null;
      } catch (e) {
        warnOnce("irrigation_system", e);
        return null;
      }
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
      // `status <> 'draft'` in SQL also drops a null status.
      return (await irrigationRows())
        .filter((o) =>
          o.field_id === fieldId &&
          (opts.includeDrafts || (o.status != null && o.status !== "draft"))
        )
        .map(mapOperation);
    },
    async listOperations({ from, to, fieldId, type, seasonId }) {
      const r = await paged((a, b) => {
        // Embedded products are filtered on the farm too (every farm table is).
        let q = db.from("operation").select(JOURNAL_SELECT).eq("farm_id", farmId)
          .eq("operation_input.farm_id", farmId).in("status", ["confirmed", "planned"]);
        q = seasonId === undefined
          ? q.gte("op_date", from).lte("op_date", to)
          : q.lte("op_date", to).or(`op_date.gte.${from},crop_season_id.eq.${seasonId}`);
        if (fieldId !== undefined) q = q.eq("field_id", fieldId);
        if (type !== undefined) q = q.eq("op_type", type);
        return q.order("op_date").order("id").range(a, b);
      });
      return r.map(mapFarmOperation);
    },
    listProducts() {
      if (!productsP) {
        productsP = paged((a, b) =>
          db.from("product").select(PRODUCT_SELECT).order("id").range(a, b)
        ).then((r) => r.map(mapProduct));
        productsP.catch(() => (productsP = null));
      }
      return productsP;
    },
    async listProductUses(productId) {
      const r = await rows(
        db.from("product_use").select(PRODUCT_USE_SELECT).eq("product_id", productId).order("id"),
      );
      return r.map(mapProductUse);
    },
    async listJournalProductNames() {
      const r = await paged((a, b) =>
        db.from("operation_input").select("product_name").eq("farm_id", farmId)
          .is("product_id", null).order("id").range(a, b)
      );
      return [...new Set(r.map((x) => x.product_name as string).filter(Boolean))];
    },
    listCropRefs: cropRefs,
    async listSales({ year, cropCode }) {
      const r = await paged((a, b) => {
        let q = db.from("sale").select(SALE_SELECT).eq("farm_id", farmId);
        if (year !== undefined) q = q.eq("harvest_year", year);
        if (cropCode !== undefined) q = q.eq("crop_code", cropCode);
        return q.order("id").range(a, b);
      });
      return r.map(mapSale);
    },
    async listMarketPrices({ year, cropCode }) {
      // Global reference table: no farm filter.
      const r = await paged((a, b) => {
        let q = db.from("market_price").select(MARKET_PRICE_SELECT);
        if (year !== undefined) q = q.eq("year", year);
        if (cropCode !== undefined) q = q.eq("crop_code", cropCode);
        return q.order("year").order("month").order("crop_code").range(a, b);
      });
      return r.map(mapMarketPrice);
    },
    async listSubsidies({ year }) {
      const r = await paged((a, b) => {
        let q = db.from("subsidy").select(SUBSIDY_SELECT).eq("farm_id", farmId);
        if (year !== undefined) q = q.eq("year", year);
        return q.order("id").range(a, b);
      });
      return r.map(mapSubsidy);
    },
    async listFarmEconomics({ year }) {
      const r = await paged((a, b) => {
        let q = db.from("farm_economics").select(FARM_ECONOMICS_SELECT).eq("farm_id", farmId);
        if (year !== undefined) q = q.eq("year", year);
        return q.order("year").range(a, b);
      });
      return r.map(mapFarmEconomics);
    },
    async listRegionalBenchmarks({ year, cropGroupCode }) {
      const region = (await farmRow()).nuts3_id;
      const r = await paged((a, b) => {
        let q = db.from("regional_benchmark").select(REGIONAL_BENCHMARK_SELECT)
          .eq("nuts3_id", region);
        if (year !== undefined) q = q.eq("year", year);
        if (cropGroupCode !== undefined) q = q.eq("crop_group_code", cropGroupCode);
        return q.order("year").order("crop_group_code").range(a, b);
      });
      return r.map(mapRegionalBenchmark);
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
      irrigationsChanged();
      if (!r) fail("insert returned no row");
      return mapOperation(r!);
    },
    async setIrrigationStatus(operationId, status) {
      const r = await one(
        db.from("operation").update({ status, updated_at: new Date().toISOString() })
          .eq("id", operationId).eq("farm_id", farmId).eq("op_type", "irrigation").select("*"),
      );
      irrigationsChanged();
      if (!r) throw notFound(operationId);
      return mapOperation(r);
    },
    async updateIrrigation(operationId, change) {
      const r = await one(
        db.from("operation").update(toOperationUpdate(change, new Date()))
          .eq("id", operationId).eq("farm_id", farmId).eq("op_type", "irrigation").select("*"),
      );
      irrigationsChanged();
      if (!r) throw notFound(operationId);
      return mapOperation(r);
    },
    async deleteIrrigation(operationId) {
      const r = await rows(
        db.from("operation").delete().eq("id", operationId).eq("farm_id", farmId)
          .eq("op_type", "irrigation").select("id"),
      );
      irrigationsChanged();
      if (r.length === 0) throw notFound(operationId);
    },
  };
}

/** Farm lookups across the shared database, plus one cached FarmData per farm. */
export function createSupabaseFarmDirectory(db: SupabaseClient): FarmDirectory {
  const perFarm = new Map<number, FarmData>();
  // Every request resolves its caller's farm first: keep the member -> farm map (seeded data)
  // instead of one round trip ahead of everything else.
  let membersP: { at: number; value: Promise<Map<number, number>> } | null = null;
  function memberFarms(): Promise<Map<number, number>> {
    if (membersP && Date.now() - membersP.at < FARM_TABLE_TTL_MS) return membersP.value;
    const value = paged((a, b) => db.from("member").select("id,farm_id").order("id").range(a, b))
      .then((r) => new Map(r.map((m) => [m.id as number, m.farm_id as number])));
    const entry = { at: Date.now(), value };
    membersP = entry;
    value.catch(() => {
      if (membersP === entry) membersP = null;
    });
    return value;
  }
  return {
    async listFarmIds() {
      return (await rows(db.from("farm").select("id").order("id"))).map((r) => r.id as number);
    },
    async farmOfMember(memberId) {
      const known = (await memberFarms()).get(memberId);
      if (known !== undefined) return known;
      // A member added since the last read.
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
