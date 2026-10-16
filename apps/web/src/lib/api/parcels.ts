import { FarmTodaySchema, ParcelReportSchema, type FarmToday, type ParcelReport } from "@tellia/shared";
import { mock } from "./core";
import oakfieldAdvice from "../../fixtures/oakfield/advice.json";
import ridgewayAdvice from "../../fixtures/ridgeway/advice.json";
import valleyReport from "../../fixtures/oakfield/parcel-report.valley.json";
import northSlopeReport from "../../fixtures/ridgeway/parcel-report.northslope.json";

const TODAY_BY_FARM: Record<number, unknown> = {
  1: oakfieldAdvice,
  2: ridgewayAdvice,
};

const REPORT_BY_PARCEL: Record<number, unknown> = {
  101: valleyReport, // The Valley (Oakfield)
  201: northSlopeReport, // North Slope (Ridgeway)
};

// MOCK: replace with GET /irrigation/advice (x-member-id scopes the farm),
// mapped FarmAdvice → FarmToday by a pure mapper (Phase 4).
export async function getFarmToday(farmId: number): Promise<FarmToday> {
  return mock(FarmTodaySchema, TODAY_BY_FARM[farmId] ?? oakfieldAdvice);
  // REAL: return toFarmToday(await http.get("/irrigation/advice", FarmAdviceSchema));
}

// MOCK: replace with GET /farms/:farmId/parcels/:parcelId/report (the data
// teammate's `get_parcel_report`, which returns the full ParcelReport shape —
// see docs/parcel-report-contract.md). Validate the live response with the
// version-tolerant `parseParcelReport` so a schema bump degrades gracefully.
export async function getParcelReport(parcelId: number): Promise<ParcelReport> {
  const fixture = REPORT_BY_PARCEL[parcelId];
  if (!fixture) throw new Error(`No fixture for parcel ${parcelId}`);
  return mock(ParcelReportSchema, fixture);
  // REAL:
  //   const raw = await http.getRaw(`/.../${parcelId}/report`);
  //   const report = parseParcelReport(raw);
  //   if (!report) throw new Error("parcel report: unsupported schema version");
  //   return report;
}
