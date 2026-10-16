import { Home, Mic, MessageCircle } from "lucide-react";
import type { ComponentType } from "react";
import { navigate, type RouteName } from "../../app/router";
import { v } from "../../theme/tokens";

const TABS: { name: RouteName; label: string; Icon: ComponentType<{ size?: number }> }[] = [
  { name: "today", label: "Today", Icon: Home },
  { name: "chat", label: "Chat", Icon: MessageCircle },
  { name: "log", label: "Log", Icon: Mic },
];

export function TabBar({ active }: { active: RouteName }) {
  return (
    <nav
      aria-label="Main"
      style={{
        flexShrink: 0,
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        borderTop: `1px solid ${v("line")}`,
        background: v("surface"),
        padding: "6px 12px calc(14px + env(safe-area-inset-bottom))",
      }}
    >
      {TABS.map(({ name, label, Icon }) => {
        const on = name === active;
        return (
          <button
            key={name}
            type="button"
            onClick={() => navigate(name)}
            aria-current={on ? "page" : undefined}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              minHeight: 52,
              justifyContent: "center",
              border: 0,
              background: "transparent",
              cursor: "pointer",
              color: on ? v("brand") : v("ink2"),
              fontSize: 12,
              fontWeight: on ? 600 : 500,
            }}
          >
            <Icon size={22} />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
