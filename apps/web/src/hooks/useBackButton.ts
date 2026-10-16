import { useEffect } from "react";
import { App } from "@capacitor/app";
import { isNative } from "../lib/native";

/**
 * Handle the Android hardware back button. Return true if you handled it;
 * return false (or omit) to let the app exit when there's nothing to go back to.
 */
export function useBackButton(handler: () => boolean | void): void {
  useEffect(() => {
    if (!isNative) return;
    const sub = App.addListener("backButton", ({ canGoBack }) => {
      const handled = handler();
      if (!handled && !canGoBack) App.exitApp();
    });
    return () => {
      sub.then((s) => s.remove());
    };
  }, [handler]);
}
