import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { FarmSummary } from "@tellia/shared";
import { listFarms, setMemberId } from "../lib/api";
import type { ColorToken } from "../theme/tokens";

/** Avatar accent for a farm: the first farm is brand green, the rest water teal. */
export function farmAccent(farm: FarmSummary, farms: FarmSummary[]): ColorToken {
  return farms.findIndex((f) => f.id === farm.id) <= 0 ? "brand" : "water";
}

interface FarmCtx {
  farms: FarmSummary[];
  farm: FarmSummary | null;
  setFarm: (f: FarmSummary) => void;
  loading: boolean;
}

const Ctx = createContext<FarmCtx | null>(null);

// The persona switch lives here: selecting a farm re-scopes the whole app and
// sets the `x-member-id` the live API uses to scope irrigation + chat.
export function FarmProvider({ children }: { children: ReactNode }) {
  const [farms, setFarms] = useState<FarmSummary[]>([]);
  const [farm, setFarmState] = useState<FarmSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    listFarms().then((list) => {
      if (!alive) return;
      setFarms(list);
      const first = list.find((f) => f.featured) ?? list[0] ?? null;
      setFarmState(first);
      if (first) setMemberId(first.memberId);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const value = useMemo<FarmCtx>(
    () => ({
      farms,
      farm,
      loading,
      setFarm: (f: FarmSummary) => {
        setFarmState(f);
        setMemberId(f.memberId);
      },
    }),
    [farms, farm, loading],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFarm(): FarmCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useFarm must be used inside FarmProvider");
  return c;
}
