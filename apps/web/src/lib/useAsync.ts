import { useEffect, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Run an async loader, tracking loading/error, cancelling on unmount/dep change. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => {
        if (alive) setState({ data, loading: false, error: null });
      },
      (e: unknown) => {
        if (alive)
          setState({
            data: null,
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          });
      },
    );
    return () => {
      alive = false;
    };
    // deps are the caller's contract for when to reload
  }, deps);
  return state;
}
