import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { FarmSummary } from "@tellia/shared";
import { farmsQuery, fetchQuery, peek, setMemberId } from "../lib/api";
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

const defaultFarm = (list: FarmSummary[]): FarmSummary | null =>
  list.find((f) => f.featured) ?? list[0] ?? null;

// The persona switch lives here: selecting a farm re-scopes the whole app and
// sets the `x-member-id` the live API uses to scope irrigation + chat.
// The list paints from the last launch's copy, then refreshes in the background.
export function FarmProvider({ children }: { children: ReactNode }) {
  const [farms, setFarms] = useState<FarmSummary[]>(() => peek(farmsQuery) ?? []);
  const [farm, setFarmState] = useState<FarmSummary | null>(() => {
    const first = defaultFarm(farms);
    // Before any child renders: their first calls already carry the member.
    if (first) setMemberId(first.memberId);
    return first;
  });
  const [loading, setLoading] = useState(farm === null);

  useEffect(() => {
    let alive = true;
    fetchQuery(farmsQuery).then((list) => {
      if (!alive) return;
      setFarms(list);
      // Keep the chosen farm when it is still there (fresh copy), else the default one.
      setFarmState((current) => {
        const next = list.find((f) => f.id === current?.id) ?? defaultFarm(list);
        if (next) setMemberId(next.memberId);
        return next;
      });
      setLoading(false);
    }, () => alive && setLoading(false));
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
