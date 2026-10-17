import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useHaptics } from "../../hooks/useHaptics";
import { copyText } from "../../lib/clipboard";
import { v } from "../../theme/tokens";

const CONFIRM_MS = 1500;

/** Small copy icon under an advisor answer (44px hit area). Swaps to a check for 1.5 s once copied. */
export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const haptics = useHaptics();
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    if (!(await copyText(text))) return;
    haptics.tap();
    setDone(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), CONFIRM_MS);
  };

  return (
    <button
      type="button"
      aria-label={done ? "Copied" : "Copy answer"}
      onClick={() => void copy()}
      style={{
        alignSelf: "flex-start",
        width: 44,
        height: 44,
        margin: "-12px 0 -12px -8px",
        border: 0,
        background: "transparent",
        color: done ? v("brand") : v("ink2"),
        opacity: done ? 1 : 0.7,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
    </button>
  );
}
