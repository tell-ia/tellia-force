import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Keyboard } from "@capacitor/keyboard";

/** True when running inside the Capacitor native shell (Android), not the browser. */
export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // "android" | "ios" | "web"

/** One-time native setup. Call before rendering. No-ops on web. */
export async function initNative(): Promise<void> {
  if (!isNative) return;
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    // setAccessoryBarVisible is iOS-only — it throws "not implemented" on Android.
    if (platform === "ios") {
      await Keyboard.setAccessoryBarVisible({ isVisible: true });
    }
  } catch {
    // Plugin not available on this platform — ignore for the hackathon.
  }
}

/** Match the status bar icon color to the theme (dark bg → light icons). */
export async function setStatusBarTheme(dark: boolean): Promise<void> {
  if (!isNative) return;
  try {
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
  } catch {
    /* ignore */
  }
}

/**
 * Handle deep links into the app, e.g. a push notification opening
 * `telliaforce://parcel/101#balance`. Returns the in-app path (`parcel/101#balance`)
 * to feed to the router. No-op on web; returns an unsubscribe.
 */
export function onDeepLink(handler: (path: string) => void): () => void {
  if (!isNative) return () => {};
  const sub = CapApp.addListener("appUrlOpen", (e: { url: string }) => {
    const scheme = e.url.match(/^telliaforce:\/\/(.*)$/);
    if (scheme) return handler(scheme[1] ?? "");
    const hash = e.url.split("#/")[1];
    if (hash) handler(hash);
  });
  return () => {
    void sub.then((l) => l.remove());
  };
}
