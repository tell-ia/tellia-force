import { Capacitor } from "@capacitor/core";
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
