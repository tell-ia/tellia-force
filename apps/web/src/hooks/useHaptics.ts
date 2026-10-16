import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { isNative } from "../lib/native";

/**
 * Haptic feedback, safe to call anywhere — no-ops on web.
 * const h = useHaptics(); h.tap();  // on a button press
 */
export function useHaptics() {
  const guard = (fn: () => Promise<unknown>) => () => {
    if (isNative) fn().catch(() => {});
  };
  return {
    tap: guard(() => Haptics.impact({ style: ImpactStyle.Light })),
    impact: guard(() => Haptics.impact({ style: ImpactStyle.Medium })),
    heavy: guard(() => Haptics.impact({ style: ImpactStyle.Heavy })),
    success: guard(() => Haptics.notification({ type: NotificationType.Success })),
    error: guard(() => Haptics.notification({ type: NotificationType.Error })),
  };
}
