// What-if events applied on top of the baseline weather and irrigations. Pure.
import type { FieldReport, ScenarioComparison, ScenarioEvent } from "@tellia/shared/irrigation";
import { addDays, round1 } from "./util";
import type { IrrigationInput } from "./waterBalance";

interface ScenarioDay {
  date: string;
  et0: number;
  rain: number;
  tmin: number;
}

export function applyScenario<T extends ScenarioDay>(
  days: T[],
  irrigations: IrrigationInput[],
  events: ScenarioEvent[],
): { days: T[]; irrigations: IrrigationInput[]; warnings: string[] } {
  const out = days.map((d) => ({ ...d }));
  const irr = irrigations.map((i) => ({ ...i }));
  const warnings: string[] = [];
  const find = (date: string) => out.find((d) => d.date === date);

  for (const e of events) {
    const day = find(e.date);
    if (!day) {
      warnings.push(`Ignored ${e.type} on ${e.date}: no weather data for that date.`);
      continue;
    }
    switch (e.type) {
      case "rain":
        day.rain += e.mm;
        break;
      case "flood":
        day.rain += e.mm ?? 120;
        warnings.push(`Flood on ${e.date}: soil saturated, do not irrigate until it drains.`);
        break;
      case "drought": {
        const factor = round1(e.et0Factor ?? 1.3);
        for (let i = 0; i < e.days; i++) {
          const d = find(addDays(e.date, i));
          if (!d) continue;
          d.rain = 0;
          d.et0 = round1(d.et0 * factor);
        }
        break;
      }
      case "frost":
        day.tmin = e.tmin ?? -3;
        break;
      case "hail":
        warnings.push(
          `Hail on ${e.date}: check crop damage; this advice assumes an undamaged crop.`,
        );
        break;
      case "irrigation":
        irr.push({ date: e.date, mm: e.mm });
        break;
    }
  }
  return { days: out, irrigations: irr, warnings };
}

/** The amounts compare the gross dose: the water to pump, the number the farmer acts on. */
export function compareReports(baseline: FieldReport, scenario: FieldReport): ScenarioComparison {
  const decisionChanged = baseline.decision !== scenario.decision;
  const a = baseline.irrigateGrossMm;
  const b = scenario.irrigateGrossMm;
  // The net water is quoted only when part of the pumped water is lost.
  const lossy = (r: FieldReport) => r.irrigateMm !== r.irrigateGrossMm;
  const dose = (r: FieldReport) =>
    `${r.irrigateGrossMm} mm` + (lossy(r) ? ` to pump, ${r.irrigateMm} mm net` : "");
  const before = `${baseline.decision} (${dose(baseline)})`;
  const after = `${scenario.decision} (${dose(scenario)})`;
  const summary = decisionChanged
    ? `Scenario changes the decision from ${before} to ${after}.`
    : `Scenario keeps ${baseline.decision}; irrigation ${a} mm → ${b} mm` +
      (lossy(baseline) || lossy(scenario)
        ? ` to pump (${baseline.irrigateMm} mm → ${scenario.irrigateMm} mm net).`
        : ".");
  return { decisionChanged, mmBefore: a, mmAfter: b, summary };
}
