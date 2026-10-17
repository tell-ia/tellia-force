import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DemoDateState } from "@tellia/shared";
import { getDemoDate, setDemoDate } from "../lib/api";
import { localToday } from "../lib/dates";

interface DateCtx {
  /** The project's "today": what the API, the chat and VAPI use. */
  today: string;
  /** The server's date state; null until loaded, or when the API is unreachable. */
  state: DemoDateState | null;
  /** Moves "today" for everyone (null = back to the server default). Throws on refusal. */
  setDate: (date: string | null) => Promise<void>;
}

const Ctx = createContext<DateCtx | null>(null);

// The demo date lives on the API (GET/PUT /settings/date), not here: VAPI calls and texts do
// not come from the app, so the server is the only place every channel can read it.
export function DateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoDateState | null>(null);

  useEffect(() => {
    let alive = true;
    getDemoDate().then(
      (s) => alive && setState(s),
      () => {
        /* API unreachable: keep the device date */
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const value = useMemo<DateCtx>(
    () => ({
      today: state?.today ?? localToday(),
      state,
      setDate: async (date) => setState(await setDemoDate(date)),
    }),
    [state],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDemoDate(): DateCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDemoDate must be used inside DateProvider");
  return c;
}
