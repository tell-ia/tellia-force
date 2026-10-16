import { FarmTodaySchema, ParcelReportSchema, type FarmToday, type ParcelReport } from "@tellia/shared";
import { mock } from "./core";
import oakfieldAdvice from "../../fixtures/oakfield/advice.json";
import ridgewayAdvice from "../../fixtures/ridgeway/advice.json";
import valleyReport from "../../fixtures/oakfield/parcel-report.valley.json";

const TODAY_BY_FARM: Record<number, unknown> = {
  1: oakfieldAdvice,
  2: ridgewayAdvice,
};

// MOCK: replace with GET /irrigation/advice (x-member-id scopes the farm),
// mapped FarmAdvice → FarmToday by a pure mapper (Phase 4).
export async function getFarmToday(farmId: number): Promise<FarmToday> {
  return mock(FarmTodaySchema, TODAY_BY_FARM[farmId] ?? oakfieldAdvice);
  // REAL: return toFarmToday(await http.get("/irrigation/advice", FarmAdviceSchema));
}

// MOCK: replace with GET /irrigation/fields/:fieldId/report (+ balance series),
// mapped FieldReport + DayBalance[] → ParcelReport by a pure mapper (Phase 4).
export async function getParcelReport(parcelId: number): Promise<ParcelReport> {
  if (parcelId !== 101) throw new Error(`No fixture for parcel ${parcelId}`);
  return mock(ParcelReportSchema, valleyReport);
  // REAL: return toParcelReport(
  //   await http.get(`/irrigation/fields/${parcelId}/report`, FieldReportSchema),
  //   await getBalanceSeries(parcelId), // open question for Imad: simulate [] vs GET .../balance
  // );
}
