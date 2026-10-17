import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { FarmEquipmentSchema, defaultFarmEquipment, type FarmEquipment } from "@tellia/shared";

// Per-farm reel-gun equipment, edited on the Farm equipment screen and used by the
// irrigation plan. Persisted per device in localStorage (no DB write here); moving it
// to the shared DB later needs a schema migration.

const KEY = (farmId: number) => `tf-equip-${farmId}`;

function load(farmId: number): FarmEquipment {
  try {
    const raw = localStorage.getItem(KEY(farmId));
    if (raw) {
      const p = FarmEquipmentSchema.safeParse(JSON.parse(raw));
      if (p.success) return p.data;
    }
  } catch {
    /* ignore */
  }
  return defaultFarmEquipment(farmId);
}

interface EquipCtx {
  equipmentFor: (farmId: number) => FarmEquipment;
  setEquipment: (farmId: number, eq: FarmEquipment) => void;
}

const Ctx = createContext<EquipCtx | null>(null);

export function EquipmentProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<number, FarmEquipment>>({});

  const value = useMemo<EquipCtx>(
    () => ({
      equipmentFor: (farmId) => map[farmId] ?? load(farmId),
      setEquipment: (farmId, eq) => {
        setMap((m) => ({ ...m, [farmId]: eq }));
        try {
          localStorage.setItem(KEY(farmId), JSON.stringify(eq));
        } catch {
          /* ignore */
        }
      },
    }),
    [map],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEquipment(): EquipCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useEquipment must be used inside EquipmentProvider");
  return c;
}
