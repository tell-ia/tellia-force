import { useEffect, useState } from "react";
import { onInvalidate } from "./api/cache";
import { WATER_KEYS } from "./api/irrigation";

/**
 * Goes up each time a watering is saved, corrected or deleted (from the app or the chat). Put it
 * in the deps of anything built on the advice and reports, like the farm plan, so it rebuilds:
 * the cached answers it read are already dropped, so the rebuild fetches the new water.
 */
export function useWaterVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(
    () =>
      onInvalidate((changed) => {
        if (WATER_KEYS.some((k) => changed(k))) setVersion((n) => n + 1);
      }),
    [],
  );
  return version;
}
