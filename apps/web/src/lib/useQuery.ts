import { useEffect, useRef, useState } from "react";
import { fetchQuery, isFresh, onInvalidate, peek, type Query } from "./api";
import type { AsyncState } from "./useAsync";

interface KeyedState<T> extends AsyncState<T> {
  key: string | null;
}

function initial<T>(q: Query<T> | null): KeyedState<T> {
  if (!q) return { key: null, data: null, loading: false, error: null };
  const known = peek(q);
  return known === undefined
    ? { key: q.key, data: null, loading: true, error: null }
    : { key: q.key, data: known, loading: false, error: null };
}

/**
 * A cached query (see lib/api/cache.ts): renders the known answer at once, refreshes it in the
 * background unless it is fresh. `loading` is true only while there is nothing to show.
 * After a write that changes it (a watering saved or deleted), it reloads in place: the page
 * stays up, and a failed reload keeps it. `null` = nothing to load yet.
 */
export function useQuery<T>(q: Query<T> | null): AsyncState<T> {
  const key = q?.key ?? null;
  const [state, setState] = useState<KeyedState<T>>(() => initial(q));
  const latest = useRef(q);
  latest.current = q;

  // Another key: start from what the cache has for it, not from the previous key's answer.
  let current = state;
  if (state.key !== key) {
    current = initial(q);
    setState(current);
  }

  useEffect(() => {
    const query = latest.current;
    if (!query) return;
    let alive = true;
    const load = () =>
      fetchQuery(query).then(
        (data) => {
          if (alive) setState({ key: query.key, data, loading: false, error: null });
        },
        (e: unknown) => {
          if (!alive) return;
          const error = e instanceof Error ? e.message : String(e);
          // A failed reload keeps what is on screen, with the error next to it.
          setState((s) =>
            s.key === query.key && s.data !== null
              ? { ...s, loading: false, error }
              : { key: query.key, data: null, loading: false, error },
          );
        },
      );
    if (!isFresh(query)) void load();
    const stop = onInvalidate((changed) => {
      if (changed(query.key)) void load();
    });
    return () => {
      alive = false;
      stop();
    };
  }, [key]);

  return current;
}
