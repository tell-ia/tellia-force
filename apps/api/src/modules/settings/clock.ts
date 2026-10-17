// The project's "today": the demo date picked in the app, else DEMO_DATE, else the real date.
// One clock for every caller (app, chat, calls, SMS): the hackathon demo has one presenter.

import { HTTPException } from "hono/http-exception";
import { DEMO_DATE_MIN } from "@tellia/shared/app";
import { IsoDateSchema } from "@tellia/shared/irrigation";
import { todayIn } from "../irrigation/engine/util";

/** Where the demo date survives a restart. */
export interface DemoDateStore {
  load(): string | null;
  save(date: string | null): void;
}

export interface Clock {
  /** What the whole project uses as today. */
  today(): string;
  /** The calendar date in the clock's time zone. */
  realToday(): string;
  /** The date picked in the app, or null. */
  demoDate(): string | null;
  /** Sets the demo date, or clears it with null. Outside [DEMO_DATE_MIN, realToday]: 400. */
  setDemoDate(date: string | null): void;
}

export function createClock(
  deps: {
    timezone: string;
    /** DEMO_DATE from the env: today when no demo date is picked. */
    fallback?: string;
    /** Default: in memory only (tests). */
    store?: DemoDateStore;
    now?: () => Date;
  },
): Clock {
  const realToday = () => todayIn(deps.timezone, deps.now?.() ?? new Date());
  const inRange = (d: string) =>
    IsoDateSchema.safeParse(d).success && d >= DEMO_DATE_MIN && d <= realToday();

  const stored = deps.store?.load() ?? null;
  // A stored date that no longer fits (or a broken file) is dropped, never trusted.
  let demo: string | null = stored !== null && inRange(stored) ? stored : null;

  return {
    today: () => demo ?? deps.fallback ?? realToday(),
    realToday,
    demoDate: () => demo,
    setDemoDate(date) {
      if (date !== null && !inRange(date)) {
        throw new HTTPException(400, {
          message: `demo date must be between ${DEMO_DATE_MIN} and ${realToday()}`,
        });
      }
      demo = date;
      deps.store?.save(date);
    },
  };
}

/** A JSON file next to the Mastra store (`data/` is git-ignored). Read errors mean "no date". */
export function fileDemoDateStore(path: string): DemoDateStore {
  return {
    load() {
      try {
        const date = JSON.parse(Deno.readTextFileSync(path))?.date;
        return typeof date === "string" ? date : null;
      } catch {
        return null;
      }
    },
    save(date) {
      if (date === null) {
        try {
          Deno.removeSync(path);
        } catch { /* already gone */ }
        return;
      }
      const dir = path.replace(/[^/]*$/, "");
      if (dir) Deno.mkdirSync(dir, { recursive: true });
      Deno.writeTextFileSync(path, JSON.stringify({ date }) + "\n");
    },
  };
}
