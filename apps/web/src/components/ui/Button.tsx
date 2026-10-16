import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import { useHaptics } from "../../hooks/useHaptics";

type Variant = "primary" | "secondary" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-white text-neutral-950 active:bg-neutral-200",
  secondary: "bg-neutral-800 text-neutral-50 active:bg-neutral-700",
  ghost: "bg-transparent text-neutral-300 active:bg-neutral-900",
};

/** Touch-first button: big tap target, haptic tap on press, variants. */
export function Button({
  variant = "primary",
  className,
  onClick,
  haptic = true,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; haptic?: boolean }) {
  const h = useHaptics();
  return (
    <button
      className={cn(
        "w-full min-h-12 rounded-xl px-4 font-medium transition-colors",
        "disabled:opacity-50 disabled:pointer-events-none select-none",
        variants[variant],
        className,
      )}
      onClick={(e) => {
        if (haptic) h.tap();
        onClick?.(e);
      }}
      {...rest}
    />
  );
}
