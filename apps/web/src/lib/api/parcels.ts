import {
  FarmAdviceSchema,
  FarmTodaySchema,
  FieldReportSchema,
  ParcelReportSchema,
  type FarmSummary,
  type FarmToday,
  type ParcelReport,
} from "@tellia/shared";
import { getApiToday, getMemberId, http, mock } from "./core";
import { getQuery, type Query } from "./cache";
import { list } from "./data";
import { toFarmToday } from "../mappers/today";
import { fieldReportToParcelReport } from "../mappers/parcel";
import { buildRefillPlan } from "./plan";
import oakfieldAdvice from "../../fixtures/oakfield/advice.json";
import ridgewayAdvice from "../../fixtures/ridgeway/advice.json";
import valleyReport from "../../fixtures/oakfield/parcel-report.valley.json";
import northSlopeReport from "../../fixtures/ridgeway/parcel-report.northslope.json";

const TODAY_BY_FARM: Record<number, unknown> = { 1: oakfieldAdvice, 2: ridgewayAdvice };
const REPORT_BY_PARCEL: Record<number, unknown> = { 101: valleyReport, 201: northSlopeReport };

// LIVE: GET /irrigation/advice (scoped by x-member-id) → FarmToday. Falls back
// to the fixture offline. Shared with every screen through the cache.
export function getFarmToday(farm: FarmSummary): Promise<FarmToday> {
  return getQuery(farmTodayQuery(farm, getApiToday()));
}

/**
 * A farm's day, shared by every screen and kept across launches. `today` is the demo date the
 * API answers for (it reads its own clock): part of the key so another day is another answer.
 */
export function farmTodayQuery(farm: FarmSummary, today: string): Query<FarmToday> {
  return {
    key: `farmToday:${farm.id}:${farm.memberId}:${today}`,
    load: () => fetchFarmToday(farm),
    schema: FarmTodaySchema,
    fallback: () => farmTodayFixture(farm),
    persist: true,
  };
}

async function fetchFarmToday(farm: FarmSummary): Promise<FarmToday> {
  const [advice, fields] = await Promise.all([
    http.get("/irrigation/advice", FarmAdviceSchema),
    list("field", { limit: 100 }),
  ]);
  return toFarmToday(advice, farm, fields.data.filter((f) => f.farm_id === farm.id));
}

function farmTodayFixture(farm: FarmSummary): Promise<FarmToday> {
  return mock(FarmTodaySchema, TODAY_BY_FARM[farm.id] ?? oakfieldAdvice);
}

// LIVE: a lightweight ParcelReport from GET /irrigation/fields/:id/report
// (reco + reserve). Rich sections come from the full get_parcel_report once it
// exists. Falls back to the rich fixture for the demo parcels / offline.
export function getParcelReport(parcelId: number): Promise<ParcelReport> {
  return getQuery(parcelReportQuery(parcelId, getApiToday()));
}

/** A parcel's report, shared by the parcel screen, Log and the chat widgets. */
export function parcelReportQuery(parcelId: number, today: string): Query<ParcelReport> {
  return {
    key: `parcel:${parcelId}:${getMemberId() ?? "-"}:${today}`,
    load: () => fetchParcelReport(parcelId),
    schema: ParcelReportSchema,
    fallback: () => parcelReportFixture(parcelId),
    persist: true,
  };
}

function parcelReportFixture(parcelId: number): Promise<ParcelReport> {
  const fixture = REPORT_BY_PARCEL[parcelId];
  if (!fixture) return Promise.reject(new Error(`No data for parcel ${parcelId}`));
  return mock(ParcelReportSchema, fixture);
}

async function fetchParcelReport(parcelId: number): Promise<ParcelReport> {
  const [report, fields, crops, soils] = await Promise.all([
    http.get(`/irrigation/fields/${parcelId}/report`, FieldReportSchema),
    list("field", { limit: 100 }),
    list("crop_ref", { limit: 100 }),
    list("soil_analysis", { limit: 100 }),
  ]);
  const field = fields.data.find((f) => f.id === parcelId);
  const gddBase = crops.data.find((c) => c.crop_code === report.cropCode)?.gdd_base_c;
  const soil = soils.data.find((s) => s.field_id === parcelId) ?? null;
  const plan = await buildRefillPlan(parcelId, report).catch(() => null);
  return fieldReportToParcelReport(report, {
    farmId: field?.farm_id ?? 0,
    areaHa: field?.area_ha,
    gddBase: gddBase ?? undefined,
    soil,
    plan,
  });
}
