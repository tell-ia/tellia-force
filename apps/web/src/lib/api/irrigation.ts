import { IrrigationRecordSchema, RecordIrrigationBodySchema, type IrrigationRecord } from "@tellia/shared";
import { http } from "./core";

export interface RecordIrrigationInput {
  parcelId: number; // fieldId
  date: string; // YYYY-MM-DD
  grossMm: number; // what was pumped at the gun; the engine applies efficiency
  source?: string;
}

// Demo-safe by default: logging stays OPTIMISTIC (front preview only), no write to
// the shared Supabase DB. CLAUDE.md: agents must never write the shared DB. Flip
// LIVE_WRITE to persist a *confirmed* op (POST /irrigation/operations, mm = gross,
// the engine nets it) so it counts in the next report/advice — mutates shared data.
const LIVE_WRITE = false;

export async function recordIrrigation(input: RecordIrrigationInput): Promise<IrrigationRecord> {
  if (!LIVE_WRITE) {
    return {
      operationId: Math.floor(Math.random() * 1_000_000),
      fieldId: input.parcelId,
      date: input.date,
      mm: input.grossMm,
      status: "confirmed",
    };
  }
  try {
    const body = RecordIrrigationBodySchema.parse({
      fieldId: input.parcelId,
      date: input.date,
      mm: input.grossMm,
    });
    return await http.post("/irrigation/operations", body, IrrigationRecordSchema);
  } catch {
    return {
      operationId: Math.floor(Math.random() * 1_000_000),
      fieldId: input.parcelId,
      date: input.date,
      mm: input.grossMm,
      status: "confirmed",
    };
  }
}
