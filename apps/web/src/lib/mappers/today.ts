import type { Field, FarmAdvice, FarmSummary, FarmToday, FieldReport, ParcelStatus, ParcelSummary } from "@tellia/shared";
import { cropLabel, eveLabel, refillPlan } from "./parcel";

// Engine FarmAdvice (ranked FieldReport[]) → the Today screen's FarmToday.
// Pure; tested in today.test.ts.

function statusOf(r: FieldReport): ParcelStatus {
  if (!r.irrigable) return "idle";
  if (r.decision === "irrigate_today" || r.decision === "plan_irrigation") return "action";
  return "ok";
}

function dayLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]}`;
}

function badgeOf(r: FieldReport): string {
  if (!r.irrigable) return "Rain-fed";
  switch (r.decision) {
    case "irrigate_today":
      return "Irrigate now";
    case "plan_irrigation": {
      const by = dayLabel(r.irrigateBy);
      return by ? `Irrigate by ${by}` : "Irrigate soon";
    }
    case "frost_hold":
      return "Hold · frost";
    case "crop_maturing":
      return "Maturing";
    case "wait_for_rain":
      return "Wait for rain";
    default:
      if (r.daysUntilIrrigation != null) {
        const d = r.daysUntilIrrigation;
        return `OK · ${d} more day${d > 1 ? "s" : ""}`;
      }
      return "On track";
  }
}

const RANK: Record<ParcelStatus, number> = { action: 0, ok: 1, idle: 2 };

export function toFarmToday(advice: FarmAdvice, farm: FarmSummary, fields: Field[]): FarmToday {
  const areaById = new Map(fields.map((f) => [f.id, f.area_ha]));

  const parcels: ParcelSummary[] = advice.reports
    .map((r) => {
      const acting = statusOf(r) === "action";
      return {
        id: r.fieldId,
        name: r.fieldName,
        cropName: cropLabel(r.cropCode, r.cropName),
        areaHa: areaById.get(r.fieldId) ?? 0,
        stageLabel: r.stageLabel,
        status: statusOf(r),
        badgeLabel: badgeOf(r),
        netMm: acting ? r.irrigateMm : null,
        reservePct: acting ? 100 - r.depletionPct : null,
        thresholdLabel: acting ? eveLabel(r.asOf, r.daysUntilIrrigation) : null,
        refillNote: acting ? (refillPlan(r.depletionMm, r.irrigateMm)?.note ?? null) : null,
      } satisfies ParcelSummary;
    })
    .sort((a, b) => RANK[a.status] - RANK[b.status]);

  const actions = parcels.filter((p) => p.status === "action").length;
  const who = farm.farmerName || "there";
  const greeting =
    `Good morning, ${who}. ` +
    (actions === 0
      ? "Nothing urgent today."
      : actions === 1
        ? "One field needs water."
        : `${actions} fields need water.`);

  return {
    farmId: farm.id,
    asOf: advice.asOf,
    greeting,
    weatherNote: actions ? "Fields below are ranked by urgency." : "All fields on track.",
    parcels,
    alert: null,
  };
}
