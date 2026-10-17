import { useEffect, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface AsyncOptions {
  /** On a failed load, keep the last data instead of clearing it (a failed reload leaves the
   *  screen up); the caller shows the error next to it. */
  keepDataOnError?: boolean;
}

/** The state after a failed load. */
export function failedLoad<T>(prev: AsyncState<T>, error: string, keepData: boolean): AsyncState<T> {
  return { data: keepData ? prev.data : null, loading: false, error };
}

/** Run an async loader, tracking loading/error, cancelling on unmount/dep change. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], options: AsyncOptions = {}): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  });
  const keepData = options.keepDataOnError ?? false;
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => {
        if (alive) setState({ data, loading: false, error: null });
      },
      (e: unknown) => {
        if (alive) setState((s) => failedLoad(s, e instanceof Error ? e.message : String(e), keepData));
      },
    );
    return () => {
      alive = false;
    };
    // deps are the caller's contract for when to reload
  }, deps);
  return state;
}
