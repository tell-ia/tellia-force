import type { CSSProperties, ReactNode } from "react";
import { font, radius, v } from "../../theme/tokens";

// Small shared building blocks. Every color/radius/space comes from tokens.

export function Label({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: v("ink2"),
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function DateChip({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 500,
        color: v("ink2"),
        background: v("sunk"),
        borderRadius: radius.chip,
        padding: "5px 11px",
      }}
    >
      {children}
    </span>
  );
}

/** A surface card with 1px line border. `accent` swaps the border to the action color. */
export function SectionCard({
  children,
  accent = false,
  id,
  style,
}: {
  children: ReactNode;
  accent?: boolean;
  id?: string;
  style?: CSSProperties;
}) {
  return (
    <section
      id={id}
      style={{
        background: v("surface"),
        border: `${accent ? "1.5px" : "1px"} solid ${accent ? v("act") : v("line")}`,
        borderRadius: radius.section,
        padding: "18px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

export type PillTone = "action" | "watch" | "ok";

export function StatusPill({
  tone,
  label,
  icon,
}: {
  tone: PillTone;
  label: string;
  icon?: ReactNode;
}) {
  const skin: Record<PillTone, CSSProperties> = {
    action: { background: v("act"), color: v("bg") },
    watch: { background: v("waterSoft"), color: v("ink") },
    ok: { background: v("okSoft"), color: v("ink") },
  };
  const dot = tone === "watch" ? v("water") : tone === "ok" ? v("brand") : null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        borderRadius: radius.pill,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
        ...skin[tone],
      }}
    >
      {icon}
      {dot && (
        <span
          style={{ width: 7, height: 7, borderRadius: 4, background: dot, display: "inline-block" }}
        />
      )}
      {label}
    </span>
  );
}

/** A sunk stat tile: small caption + big display value + sub. */
export function StatTile({
  caption,
  value,
  unit,
  sub,
  background,
}: {
  caption: string;
  value: ReactNode;
  unit?: string;
  sub?: string;
  background?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        background: background ?? v("sunk"),
        borderRadius: radius.tile,
        padding: "10px 12px",
      }}
    >
      <span style={{ fontSize: 11, color: v("ink2") }}>{caption}</span>
      <span style={{ fontFamily: font.display, fontWeight: 600, fontSize: 28, lineHeight: 1 }}>
        {value}
        {unit && <span style={{ fontSize: 16 }}> {unit}</span>}
      </span>
      {sub && <span style={{ fontSize: 11, color: v("ink2") }}>{sub}</span>}
    </div>
  );
}

export const displayFont: CSSProperties = { fontFamily: font.display };
export const bodyFont: CSSProperties = { fontFamily: font.body };
