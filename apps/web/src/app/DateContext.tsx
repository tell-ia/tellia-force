import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DemoDateState } from "@tellia/shared";
import { demoDateQuery, fetchQuery, peek, setApiToday, setDemoDate, setQueryData } from "../lib/api";
import { localToday } from "../lib/dates";

interface DateCtx {
  /** The project's "today": what the API, the chat and VAPI use. */
  today: string;
  /** The server's date state; null until loaded, or when the API is unreachable. */
  state: DemoDateState | null;
  /** False until "today" is known (last launch's, the server's, or the device's after a failure). */
  ready: boolean;
  /** Moves "today" for everyone (null = back to the server default). Throws on refusal. */
  setDate: (date: string | null) => Promise<void>;
}

const Ctx = createContext<DateCtx | null>(null);

/** An unreachable API (wrong LAN IP) can hang for long: start on the device date after this. */
const READY_TIMEOUT_MS = 1500;

// The demo date lives on the API (GET/PUT /settings/date), not here: VAPI calls and texts do
// not come from the app, so the server is the only place every channel can read it.
// Screens key their data on "today": they wait for it, so a late server date never makes them
// load the device date's day first and then reload.
export function DateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoDateState | null>(() => peek(demoDateQuery) ?? null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let alive = true;
    const timeout = setTimeout(() => alive && setSettled(true), READY_TIMEOUT_MS);
    fetchQuery(demoDateQuery)
      .then(
        (s) => alive && setState(s),
        () => {
          /* API unreachable: keep the last known date, else the device date */
        },
      )
      .finally(() => alive && setSettled(true));
    return () => {
      alive = false;
      clearTimeout(timeout);
    };
  }, []);

  const today = state?.today ?? localToday();
  // Before any screen renders: the plain loaders (getFarmToday...) key the cache on it.
  setApiToday(today);

  const value = useMemo<DateCtx>(
    () => ({
      today,
      state,
      ready: state !== null || settled,
      setDate: async (date) => {
        const next = await setDemoDate(date);
        setQueryData(demoDateQuery, next);
        setState(next);
      },
    }),
    [today, state, settled],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDemoDate(): DateCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDemoDate must be used inside DateProvider");
  return c;
}
