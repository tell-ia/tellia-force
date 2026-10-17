import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  clearQueryCache,
  fetchQuery,
  getQuery,
  invalidateQueries,
  isFresh,
  onInvalidate,
  peek,
  type Query,
} from "./cache";

const Schema = z.object({ n: z.number() });
type Val = z.infer<typeof Schema>;

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
}

const query = (over: Partial<Query<Val>> = {}): Query<Val> => ({
  key: "k",
  load: () => Promise.resolve({ n: 1 }),
  schema: Schema,
  persist: true,
  ...over,
});

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage());
  clearQueryCache();
});
afterEach(() => vi.unstubAllGlobals());

describe("query cache", () => {
  it("shares one request between concurrent callers", async () => {
    const load = vi.fn(() => Promise.resolve({ n: 1 }));
    const [a, b] = await Promise.all([fetchQuery(query({ load })), fetchQuery(query({ load }))]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(isFresh(query())).toBe(true);
  });

  it("restores a persisted answer after a restart, stale so it refreshes", async () => {
    await fetchQuery(query());
    clearQueryCache(); // app restart: memory gone, storage kept
    expect(peek(query())).toEqual({ n: 1 });
    expect(isFresh(query())).toBe(false);
  });

  it("drops a stored answer that no longer matches the schema", () => {
    localStorage.setItem("tf:q1:k", JSON.stringify({ n: "old shape" }));
    expect(peek(query())).toBeUndefined();
    expect(localStorage.getItem("tf:q1:k")).toBeNull();
  });

  it("keeps the last real answer when the API fails, before any fallback", async () => {
    await fetchQuery(query());
    const fallback = vi.fn(() => Promise.resolve({ n: 99 }));
    const failing = query({ load: () => Promise.reject(new Error("offline")), fallback });
    expect(await fetchQuery(failing)).toEqual({ n: 1 });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("uses the fallback only when nothing is known, and never persists it", async () => {
    const failing = query({
      load: () => Promise.reject(new Error("offline")),
      fallback: () => Promise.resolve({ n: 99 }),
    });
    expect(await fetchQuery(failing)).toEqual({ n: 99 });
    expect(localStorage.getItem("tf:q1:k")).toBeNull();
    expect(isFresh(failing)).toBe(false); // retried live next time
  });

  it("throws when the API fails with nothing known and no fallback", async () => {
    await expect(fetchQuery(query({ load: () => Promise.reject(new Error("offline")) }))).rejects.toThrow(
      "offline",
    );
  });

  it("a plain call reuses a fresh answer, and asks again once it is stale", async () => {
    const load = vi.fn(() => Promise.resolve({ n: 1 }));
    await getQuery(query({ load, freshMs: 60_000 }));
    await getQuery(query({ load, freshMs: 60_000 }));
    expect(load).toHaveBeenCalledTimes(1);
    await getQuery(query({ load, freshMs: 0 }));
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("after a write (invalidateQueries)", () => {
  it("forgets matching answers in memory and storage, keeps the others", async () => {
    await fetchQuery(query({ key: "parcel:1" }));
    await fetchQuery(query({ key: "farms" }));
    invalidateQueries(["parcel:"]);
    clearQueryCache(); // even after a restart, the dropped answer is not restored
    expect(peek(query({ key: "parcel:1" }))).toBeUndefined();
    expect(peek(query({ key: "farms" }))).toEqual({ n: 1 });
  });

  it("does not store an answer that was asked before the write", async () => {
    let answer!: (v: Val) => void;
    const before = fetchQuery(query({ key: "parcel:1", load: () => new Promise((r) => (answer = r)) }));
    invalidateQueries(["parcel:"]); // the write lands while the old read is in flight
    answer({ n: 1 }); // the old read answers with pre-write numbers
    await before;
    expect(peek(query({ key: "parcel:1" }))).toBeUndefined();
    // and the next caller starts a new request instead of joining the old one
    const after = await fetchQuery(query({ key: "parcel:1", load: () => Promise.resolve({ n: 2 }) }));
    expect(after).toEqual({ n: 2 });
  });

  it("tells mounted screens which keys changed", () => {
    const seen: boolean[] = [];
    const stop = onInvalidate((changed) => seen.push(changed("farmToday:1:1:2026-07-15"), changed("farms")));
    invalidateQueries(["farmToday:", "parcel:"]);
    stop();
    invalidateQueries(["farmToday:"]);
    expect(seen).toEqual([true, false]);
  });
});
