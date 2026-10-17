// FarmData: the only door to farm data for the irrigation engine and services.
// Types are camelCase; the Supabase implementation (Task 5) maps snake_case rows
// at this boundary, and an in-memory twin implements it for tests.

import type { CropParams, CropPhases } from "../engine/cropModel";
import type { SoilWaterClass } from "../engine/soil";

export type IsoDate = string;
export type OperationStatus = "draft" | "planned" | "confirmed";

/** Who created an operation: exactly the values the DB check on `operation.source` allows. */
export const OPERATION_SOURCES = ["import", "whatsapp", "phone_call", "web", "agent"] as const;
export type OperationSource = (typeof OPERATION_SOURCES)[number];

export interface Farm {
  id: number;
  name: string;
  lat: number;
  lon: number;
  /** Region mean annual precipitation / mean annual ET0. Below 0.5 = dry region. Null if unknown. */
  aridityIndex?: number | null;
  /** ISO country ("FR", "ES"...). E-Phy product rules are French. Missing = unknown. */
  countryCode?: string | null;
}

export interface Member {
  id: number;
  name: string;
  language: string;
  mainContact: boolean;
}

export interface Field {
  id: number;
  name: string;
  areaHa: number;
  irrigable: boolean;
  centroid: { lat: number; lon: number } | null;
  /** owned, rented... */
  tenure?: string | null;
}

export interface CropSeason {
  id: number;
  cropCode: string;
  sowingDate: IsoDate;
  harvestDate: IsoDate;
  status: string;
  /** Variety group ("early", "late"...): picks the crop phase row. Null = default row. */
  earlinessGroup?: string | null;
  variety?: string | null;
  previousCropCode?: string | null;
}

/** A soil analysis. The engine reads sand, clay and organic matter; the rest is for people. */
export interface SoilAnalysis {
  sandPct: number;
  clayPct: number;
  organicMatterPct: number;
  sampledOn?: IsoDate | null;
  siltPct?: number | null;
  ph?: number | null;
  nitrogenGKg?: number | null;
  phosphorusMgKg?: number | null;
  potassiumMgKg?: number | null;
  sulfurMgKg?: number | null;
  calciumMgKg?: number | null;
  magnesiumMgKg?: number | null;
  zincMgKg?: number | null;
  boronMgKg?: number | null;
  cecCmolKg?: number | null;
  bulkDensityKgDm3?: number | null;
  limeRequirementTHa?: number | null;
}

export interface CropRef {
  code: string;
  nameFr: string;
  nameEn: string;
  /** Language code -> crop name, for every language the DB has a name in. */
  names: Record<string, string>;
  gddBaseC: number;
  kcIni: number;
  kcMid: number;
  kcEnd: number;
}

export interface CropStage {
  seasonFraction: number;
  kc: number;
  label?: string | null;
  bbch?: number | null;
}

/** A weather day exactly as stored in `weather_daily`. */
export interface StoredWeatherDay {
  date: IsoDate;
  et0: number;
  rain: number;
  tmin: number;
  tmean: number;
  tmax?: number | null;
  gddBase0: number | null;
  gddBase5: number | null;
  gddBase6: number | null;
  gddBase10: number | null;
}

/** Irrigation equipment of a field (`irrigation_system`). Doses are gross mm. */
export interface IrrigationSystem {
  id: number;
  name: string;
  /** reel_gun, pivot, sprinkler or drip. */
  type?: string | null;
  /** Share of pumped water that reaches the roots: net mm = gross mm x efficiency. */
  efficiency: number;
  doseMinMm: number | null;
  /** Most water one pass can apply (gross mm). */
  doseMaxMm: number | null;
  /** Days to water every field it serves once. */
  roundDays: number | null;
}

/** One row of `crop_phase_gdd`: phase ends of a crop for one variety group (null = default row). */
export interface CropPhaseRow {
  cropCode: string;
  earlinessGroup: string | null;
  phases: CropPhases;
  method?: string | null;
}

export interface IrrigationOperation {
  operationId: number;
  fieldId: number;
  seasonId: number | null;
  date: IsoDate;
  mm: number;
  status: OperationStatus;
  source: OperationSource;
  memberId: number | null;
}

/** Journal operation types (`operation.op_type`). */
export type OperationType =
  | "sowing"
  | "fertilisation"
  | "spraying"
  | "irrigation"
  | "harvest"
  | "tillage"
  | "observation"
  | "other";

/** A product used in an operation (`operation_input`). Dose is per hectare. */
export interface OperationProduct {
  productId: number | null;
  productName: string;
  dose: number | null;
  doseUnit: string | null;
  target: string | null;
}

/** One journal row (`operation`) with its products. Values that do not apply may be absent. */
export interface FarmOperation {
  operationId: number;
  fieldId: number;
  seasonId: number | null;
  date: IsoDate;
  type: OperationType;
  status: OperationStatus | "cancelled";
  bbch?: number | null;
  fertiliserType?: string | null;
  nKgHa?: number | null;
  p2o5KgHa?: number | null;
  k2oKgHa?: number | null;
  waterMm?: number | null;
  variety?: string | null;
  seedRateKgHa?: number | null;
  yieldTHa?: number | null;
  moisturePct?: number | null;
  proteinPct?: number | null;
  method?: string | null;
  notes?: string | null;
  products: OperationProduct[];
}

/** A crop protection product of the E-Phy catalogue (`product`, shared by every farm). */
export interface Product {
  id: number;
  name: string;
  /** French marketing authorisation number (AMM). */
  ammNumber: string | null;
  /** herbicide, fungicide, insecticide... */
  kind: string | null;
  activeSubstances: string | null;
}

/** An authorised use of a product on a crop (`product_use`, E-Phy, shared by every farm). */
export interface ProductUse {
  productId: number;
  cropCode: string;
  target: string | null;
  maxDose: number | null;
  doseUnit: string | null;
  maxApplications: number | null;
  preHarvestIntervalDays: number | null;
  bbchMin: number | null;
  bbchMax: number | null;
  bufferZoneWaterM: number | null;
  conditions: string | null;
}

/** Which journal rows to read. Dates are inclusive. */
export interface OperationFilter {
  from: IsoDate;
  to: IsoDate;
  fieldId?: number;
  type?: OperationType;
}

export interface NewIrrigation {
  fieldId: number;
  seasonId: number;
  date: IsoDate;
  mm: number;
  status: OperationStatus;
  source: OperationSource;
  memberId: number | null;
}

/** The crop name in a language ("fr", "es", "it-IT"...), falling back to English. */
export function cropNameIn(ref: CropRef, language: string): string {
  return ref.names[language.slice(0, 2).toLowerCase()] ?? ref.nameEn;
}

/** Phases of a crop: the row of its variety group, else its default row, else null. */
export function pickCropPhases(
  rows: CropPhaseRow[],
  code: string,
  earlinessGroup: string | null,
): { phases: CropPhases; method: string | null } | null {
  const ofCrop = rows.filter((r) => r.cropCode === code);
  const exact = earlinessGroup == null
    ? undefined
    : ofCrop.find((r) => r.earlinessGroup === earlinessGroup);
  const row = exact ?? ofCrop.find((r) => r.earlinessGroup == null);
  return row ? { phases: row.phases, method: row.method ?? null } : null;
}

/**
 * Several farms share the database. The directory finds a member's farm and hands out a
 * FarmData scoped to one farm: its members, fields, operations and region weather only.
 */
export interface FarmDirectory {
  /** Every farm id, ascending. */
  listFarmIds(): Promise<number[]>;
  /** The farm of a member, or null when the member does not exist. */
  farmOfMember(memberId: number): Promise<number | null>;
  /** Main contact of the first farm (lowest id): the caller when no member is given. */
  defaultMemberId(): Promise<number | null>;
  forFarm(farmId: number): FarmData;
}

/** One farm's data. Lookups by member or operation id return null outside that farm. */
export interface FarmData {
  getFarm(): Promise<Farm>;
  listMembers(): Promise<Member[]>;
  getMember(id: number): Promise<Member | null>;
  listFields(): Promise<Field[]>;
  /** Crop season with sowing <= date <= harvest, or null. */
  getSeasonAt(fieldId: number, date: IsoDate): Promise<CropSeason | null>;
  /** Latest soil analysis, or null. */
  getSoil(fieldId: number): Promise<SoilAnalysis | null>;
  getCropRef(code: string): Promise<CropRef | null>;
  /** Sorted by seasonFraction ascending. */
  getCropStages(code: string): Promise<CropStage[]>;
  /** FAO-56 values of a crop (degree-day base, Kc, roots, p), or null when a table lacks it. */
  getCropParams(code: string): Promise<CropParams | null>;
  /** Phase ends in degree-days: the variety group's row, else the crop's default row, else null. */
  getCropPhases(
    code: string,
    earlinessGroup: string | null,
  ): Promise<{ phases: CropPhases; method: string | null } | null>;
  /** FAO-56 Table 19 rows (θFC, θWP per texture class); empty when the table is missing. */
  getSoilWaterClasses(): Promise<SoilWaterClass[]>;
  /** The field's irrigation equipment, or null when it has none. */
  getIrrigationSystem(fieldId: number): Promise<IrrigationSystem | null>;
  /** Stored days in [from, to] inclusive; days the DB lacks are simply absent. */
  getWeather(from: IsoDate, to: IsoDate): Promise<StoredWeatherDay[]>;
  /** "MM-DD" -> mean GDD for that calendar day over 2015-2024. */
  getGddClimatology(base: number): Promise<Map<string, number>>;
  listIrrigations(
    fieldId: number,
    opts: { includeDrafts: boolean },
  ): Promise<IrrigationOperation[]>;
  /**
   * Journal rows in [from, to] of this farm, confirmed and planned only (drafts and cancelled
   * rows are left out), with their products. Order is not guaranteed.
   */
  listOperations(filter: OperationFilter): Promise<FarmOperation[]>;
  /** The whole E-Phy product catalogue (shared by every farm). Fails loudly, never [] on error. */
  listProducts(): Promise<Product[]>;
  /** Every authorised use of one catalogue product, all crops (shared by every farm). */
  listProductUses(productId: number): Promise<ProductUse[]>;
  /**
   * Distinct names of the products in this farm's journal that are not in the catalogue
   * (`operation_input.product_id` null): the synthetic products of farms outside France.
   */
  listJournalProductNames(): Promise<string[]>;
  /** One irrigation operation by id, or null when missing / not an irrigation. */
  getIrrigation(operationId: number): Promise<IrrigationOperation | null>;
  createIrrigation(input: NewIrrigation): Promise<IrrigationOperation>;
  setIrrigationStatus(operationId: number, status: OperationStatus): Promise<IrrigationOperation>;
  deleteIrrigation(operationId: number): Promise<void>;
}
