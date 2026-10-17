import {
  ScenarioResultSchema,
  type DayBalance,
  type FieldReport,
  type RefillPlanSeries,
} from "@tellia/shared";
import { http } from "./core";
import { toBalancePoint } from "../mappers/parcel";

// Build the real multi-pass refill plan by driving the engine: add an irrigation
// pass on each day the balance crosses the readily-available-water line
// (depletion ≥ raw — the engine's own trigger), re-simulate (real AgERA5 weather,
// the engine applies net + per-pass cap), repeat. No invented cadence.
const MAX_PASSES = 6;

export async function buildRefillPlan(
  fieldId: number,
  report: FieldReport,
): Promise<RefillPlanSeries | null> {
  if (report.decision !== "irrigate_today" && report.decision !== "plan_irrigation") return null;
  const grossPass = report.irrigateGrossMm;
  if (grossPass <= 0 || !report.series?.length) return null;

  const asOf = report.asOf;
  const passes: { type: "irrigation"; date: string; mm: number }[] = [];
  let series: DayBalance[] = report.series;

  for (let i = 0; i < MAX_PASSES; i++) {
    const trigger = series.find(
      (d) => d.date >= asOf && d.depletion >= d.raw && !passes.some((p) => p.date === d.date),
    );
    if (!trigger) break;
    passes.push({ type: "irrigation", date: trigger.date, mm: grossPass });
    try {
      const res = await http.post(
        `/irrigation/fields/${fieldId}/simulate`,
        { events: passes, date: asOf },
        ScenarioResultSchema,
      );
      series = res.series;
    } catch {
      return null;
    }
  }

  if (passes.length === 0) return null;
  return {
    series: series.map((d) => toBalancePoint(d, asOf)),
    passes: passes.map((p) => ({ date: p.date, grossMm: p.mm })),
  };
}
