import { ScenarioResultSchema, type BalancePoint } from "@tellia/shared";
import { http } from "./core";
import { toBalancePoint } from "../mappers/parcel";

export interface DoseSim {
  /** The gross dose this result was simulated for (keeps UI numbers in sync). */
  grossMm: number;
  /** The real FAO-56 balance with this dose applied on `date` (engine-computed). */
  series: BalancePoint[];
  /** Water this dose wasted above field capacity = scenario drainage − baseline drainage. */
  drainedMm: number;
}

// LIVE: POST /irrigation/fields/:id/simulate — one engine pass with the dose as a
// gross irrigation event on `date`. Returns the real FAO-56 series + the drainage
// the dose caused (vs. the no-dose baseline). Null on error → caller falls back.
export async function simulateDose(fieldId: number, date: string, grossMm: number): Promise<DoseSim | null> {
  if (grossMm <= 0) return null;
  try {
    const res = await http.post(
      `/irrigation/fields/${fieldId}/simulate`,
      { events: [{ type: "irrigation", date, mm: grossMm }], date },
      ScenarioResultSchema,
    );
    const from = (arr: { date: string; drainage: number }[]) =>
      arr.filter((d) => d.date >= date).reduce((s, d) => s + d.drainage, 0);
    const drainedMm = Math.max(0, Math.round(from(res.series) - from(res.baseline.series ?? [])));
    return { grossMm, series: res.series.map((d) => toBalancePoint(d, date)), drainedMm };
  } catch {
    return null;
  }
}
