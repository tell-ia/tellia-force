import { z } from "zod";
import { IrrigationRecordSchema, RecordIrrigationBodySchema, type IrrigationRecord } from "@tellia/shared";
import { http } from "./core";
import { invalidateQueries } from "./cache";

export interface RecordIrrigationInput {
  parcelId: number; // fieldId
  date: string; // YYYY-MM-DD
  grossMm: number; // what was pumped at the gun; the engine applies efficiency
}

// LIVE: POST /irrigation/operations. Saves a *confirmed* irrigation in the shared DB, so it
// counts in the next report and advice (Vincent's call, 2026-10-17). Errors are thrown: the
// screen must never show "Saved" for a watering that was not saved.
export async function recordIrrigation(input: RecordIrrigationInput): Promise<IrrigationRecord> {
  const body = RecordIrrigationBodySchema.parse({ fieldId: input.parcelId, date: input.date, mm: input.grossMm });
  const saved = await http.post("/irrigation/operations", body, IrrigationRecordSchema);
  waterChanged();
  return saved;
}

/** A watering counts in the farm's advice and in every report: drop the cached ones. */
function waterChanged(): void {
  invalidateQueries(["farmToday:", "parcel:"]);
}

// LIVE: GET /irrigation/operations. Confirmed irrigations of a field up to today, newest
// first — from the app, the chat, the phone or the farm's import.
export function listIrrigations(fieldId: number): Promise<IrrigationRecord[]> {
  return http.get(`/irrigation/operations?fieldId=${fieldId}`, z.array(IrrigationRecordSchema));
}

// LIVE: DELETE /irrigation/operations/:id (Undo). Only a confirmed irrigation of this farm.
export async function deleteIrrigation(operationId: number): Promise<IrrigationRecord> {
  const removed = await http.del(`/irrigation/operations/${operationId}`, IrrigationRecordSchema);
  waterChanged();
  return removed;
}
