import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl bg-neutral-900 border border-neutral-800 p-4", className)}>
      {children}
    </div>
  );
}
