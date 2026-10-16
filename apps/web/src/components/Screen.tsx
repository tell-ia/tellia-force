import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * Full-height screen wrapper that respects device safe areas (notch, nav bar).
 * Relies on `viewport-fit=cover` (set in index.html) + env(safe-area-inset-*).
 */
export function Screen({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <div
      className={cn("min-h-dvh bg-neutral-950 text-neutral-50 flex flex-col", className)}
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {title && (
        <header className="px-4 py-3 text-lg font-semibold border-b border-neutral-800">
          {title}
        </header>
      )}
      <main className="flex-1 px-4 py-4">{children}</main>
    </div>
  );
}
