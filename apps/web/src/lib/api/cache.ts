import type { z } from "zod";

// One cache for every screen. Today, Log, the parcel screen, the farm plan and the chat widgets
// all ask for the same advice and reports: each answer is fetched once and shared. Stale-while-
// revalidate: a screen shows the last answer at once and still asks the server on every open
// (a watering logged by the chat or the phone shows up). `persist` entries also go to
// localStorage, so a cold start paints the last known screen instead of a spinner, then
// refreshes. A write through the app drops the answers it changes (invalidateQueries).

export interface Query<T> {
  /** Everything the answer depends on (farm, field, demo date...). */
  key: string;
  /** The live call; throws when the API cannot answer. */
  load: () => Promise<T>;
  /** Re-validates what comes back from storage (an old app version may have saved another shape). */
  schema: z.ZodType<T>;
  /** Offline demo data, used only when nothing real is known. Never persisted. */
  fallback?: () => Promise<T>;
  persist?: boolean;
  /** Younger than this, a new caller reuses the answer instead of asking again. */
  freshMs?: number;
}

// Only long enough to merge a burst (Today, its prefetches and the farm plan asking together).
const DEFAULT_FRESH_MS = 5_000;
const STORE_PREFIX = "tf:q1:";

interface Entry {
  data: unknown;
  /** When the live answer arrived; 0 = from storage or fallback, refetch on next use. */
  at: number;
}

const memory = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
/** Bumped by each invalidation: an answer requested before it is not stored after it. */
let generation = 0;
type Listener = (changed: (key: string) => boolean) => void;
const listeners = new Set<Listener>();

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked storage (private mode, WebView settings)
  }
}

function readStored<T>(q: Query<T>): T | undefined {
  try {
    const raw = storage()?.getItem(STORE_PREFIX + q.key);
    if (raw == null) return undefined;
    const parsed = q.schema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    storage()?.removeItem(STORE_PREFIX + q.key);
  } catch {
    /* unreadable: treat as absent */
  }
  return undefined;
}

function writeStored(key: string, data: unknown): void {
  const s = storage();
  if (!s) return;
  const raw = JSON.stringify(data);
  try {
    s.setItem(STORE_PREFIX + key, raw);
  } catch {
    // Full: drop every cached answer (old dates pile up) and try once more.
    try {
      for (let i = s.length - 1; i >= 0; i--) {
        const k = s.key(i);
        if (k?.startsWith(STORE_PREFIX)) s.removeItem(k);
      }
      s.setItem(STORE_PREFIX + key, raw);
    } catch {
      /* still no room: memory only */
    }
  }
}

/** What the cache knows now (memory, else storage), without fetching. */
export function peek<T>(q: Query<T>): T | undefined {
  const hit = memory.get(q.key);
  if (hit) return hit.data as T;
  if (!q.persist) return undefined;
  const stored = readStored(q);
  if (stored !== undefined) memory.set(q.key, { data: stored, at: 0 });
  return stored;
}

/** True when the known answer is recent enough to skip a refetch. */
export function isFresh<T>(q: Query<T>): boolean {
  const hit = memory.get(q.key);
  return !!hit && hit.at > 0 && Date.now() - hit.at < (q.freshMs ?? DEFAULT_FRESH_MS);
}

/** Store an answer obtained elsewhere (e.g. the response of a write). */
export function setQueryData<T>(q: Query<T>, data: T): void {
  memory.set(q.key, { data, at: Date.now() });
  if (q.persist) writeStored(q.key, data);
}

/**
 * The live answer, shared by concurrent callers. When the API fails, keeps the last known
 * answer if there is one, else the fallback (marked stale so the next use retries).
 */
export function fetchQuery<T>(q: Query<T>): Promise<T> {
  const running = inflight.get(q.key);
  if (running) return running as Promise<T>;
  const asked = generation;
  const p = q
    .load()
    .then(
      (data) => {
        if (asked === generation) setQueryData(q, data);
        return data;
      },
      async (e: unknown) => {
        const known = peek(q);
        if (known !== undefined) return known;
        if (!q.fallback) throw e;
        const data = await q.fallback();
        memory.set(q.key, { data, at: 0 });
        return data;
      },
    )
    .finally(() => {
      if (inflight.get(q.key) === p) inflight.delete(q.key);
    });
  inflight.set(q.key, p);
  return p;
}

/** The answer for a plain call: the fresh one if any, else asked now (shared with other callers). */
export function getQuery<T>(q: Query<T>): Promise<T> {
  return isFresh(q) ? Promise.resolve(memory.get(q.key)!.data as T) : fetchQuery(q);
}

/**
 * Forget every answer whose key starts with one of `prefixes` (memory, storage, requests in
 * flight), after a write that changes them. Mounted screens showing one reload it in place.
 */
export function invalidateQueries(prefixes: string[]): void {
  const changed = (key: string) => prefixes.some((p) => key.startsWith(p));
  generation++;
  for (const key of [...memory.keys()]) if (changed(key)) memory.delete(key);
  for (const key of [...inflight.keys()]) if (changed(key)) inflight.delete(key);
  const s = storage();
  try {
    for (let i = (s?.length ?? 0) - 1; i >= 0; i--) {
      const k = s!.key(i);
      if (k?.startsWith(STORE_PREFIX) && changed(k.slice(STORE_PREFIX.length))) s!.removeItem(k);
    }
  } catch {
    /* storage unavailable: memory is already clean */
  }
  for (const l of listeners) l(changed);
}

/** Called after each invalidation with a test on keys; returns the unsubscribe. */
export function onInvalidate(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Warm the cache ahead of a screen; errors are ignored (the screen will retry). */
export function prefetch<T>(q: Query<T>): Promise<void> {
  if (isFresh(q)) return Promise.resolve();
  return fetchQuery(q).then(
    () => undefined,
    () => undefined,
  );
}

/** Test hook: forget everything in memory. */
export function clearQueryCache(): void {
  memory.clear();
  inflight.clear();
  listeners.clear();
}
