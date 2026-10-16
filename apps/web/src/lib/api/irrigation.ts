import { IrrigationLogSchema, type IrrigationLog } from "@tellia/shared";
import { mock } from "./core";

export interface RecordIrrigationInput {
  parcelId: number; // fieldId
  date: string; // YYYY-MM-DD
  netMm: number;
  grossMm?: number;
  status: "planned" | "done";
  source?: string;
}

// MOCK: replace with POST /irrigation/operations { fieldId, date, mm }.
// The UI applies this optimistically (planned = dashed, done = solid) before
// the response resolves.
export async function recordIrrigation(input: RecordIrrigationInput): Promise<IrrigationLog> {
  return mock(IrrigationLogSchema, {
    id: Math.floor(Math.random() * 1_000_000),
    parcelId: input.parcelId,
    date: input.date,
    netMm: input.netMm,
    grossMm: input.grossMm ?? null,
    status: input.status,
    source: input.source ?? "app",
  });
  // REAL: const rec = await http.post("/irrigation/operations",
  //   { fieldId: input.parcelId, date: input.date, mm: input.netMm }, IrrigationRecordSchema);
  //   return toLog(rec);
}
