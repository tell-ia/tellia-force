import { createContext, useContext, type ReactNode } from "react";
import type { FarmIrrigationPlan } from "@tellia/shared";
import { buildFarmPlan } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useFarm } from "./FarmContext";
import { useDemoDate } from "./DateContext";
import { useEquipment } from "./EquipmentContext";

// The farm's reel-gun rotation plan, computed once from the saved equipment and shared
// by Today and the parcel screen so both reflect the SAME rotation (what the gun does
// today, and each field's forecast re-simulated on its real watering dates).

interface FarmPlanCtx {
  plan: FarmIrrigationPlan | null;
  loading: boolean;
}

const Ctx = createContext<FarmPlanCtx>({ plan: null, loading: false });

export function FarmPlanProvider({ children }: { children: ReactNode }) {
  const { farm } = useFarm();
  const { today } = useDemoDate();
  const { equipmentFor } = useEquipment();
  const eq = farm ? equipmentFor(farm.id) : null;
  const key = farm && eq ? `${farm.id}|${today}|${eq.gunModelIds.join("-")}|${eq.pumpM3h}|${eq.moveMinutes}` : "none";

  const { data, loading } = useAsync<FarmIrrigationPlan | null>(
    () => (farm && eq ? buildFarmPlan(farm, eq) : Promise.resolve(null)),
    [key],
  );

  return <Ctx.Provider value={{ plan: data ?? null, loading }}>{children}</Ctx.Provider>;
}

export function useFarmPlan(): FarmPlanCtx {
  return useContext(Ctx);
}

/** The plan's outcome for one field (what the gun does for it + its real forecast). */
export function useFieldOutcome(fieldId: number | null | undefined) {
  const { plan } = useFarmPlan();
  if (fieldId == null || !plan) return null;
  return plan.fields.find((f) => f.fieldId === fieldId) ?? null;
}
