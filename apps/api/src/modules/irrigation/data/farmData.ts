// FarmData: the only door to farm data for the irrigation engine and services.
// Types are camelCase; the Supabase implementation (Task 5) maps snake_case rows
// at this boundary, and an in-memory twin implements it for tests.

export type IsoDate = string;
export type OperationStatus = "draft" | "planned" | "confirmed";

export interface Farm {
  id: number;
  name: string;
  lat: number;
  lon: number;
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
}

export interface CropSeason {
  id: number;
  cropCode: string;
  sowingDate: IsoDate;
  harvestDate: IsoDate;
  status: string;
}

export interface SoilAnalysis {
  sandPct: number;
  clayPct: number;
  organicMatterPct: number;
}

export interface CropRef {
  code: string;
  nameFr: string;
  nameEn: string;
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
  gddBase0: number | null;
  gddBase5: number | null;
  gddBase6: number | null;
  gddBase10: number | null;
}

export interface IrrigationOperation {
  operationId: number;
  fieldId: number;
  seasonId: number | null;
  date: IsoDate;
  mm: number;
  status: OperationStatus;
  source: string;
  memberId: number | null;
}

export interface NewIrrigation {
  fieldId: number;
  seasonId: number;
  date: IsoDate;
  mm: number;
  status: OperationStatus;
  source: string;
  memberId: number | null;
}

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
  /** Stored days in [from, to] inclusive; days the DB lacks are simply absent. */
  getWeather(from: IsoDate, to: IsoDate): Promise<StoredWeatherDay[]>;
  /** "MM-DD" -> mean GDD for that calendar day over 2015-2024. */
  getGddClimatology(base: number): Promise<Map<string, number>>;
  listIrrigations(
    fieldId: number,
    opts: { includeDrafts: boolean },
  ): Promise<IrrigationOperation[]>;
  createIrrigation(input: NewIrrigation): Promise<IrrigationOperation>;
  setIrrigationStatus(operationId: number, status: OperationStatus): Promise<IrrigationOperation>;
  deleteIrrigation(operationId: number): Promise<void>;
}
