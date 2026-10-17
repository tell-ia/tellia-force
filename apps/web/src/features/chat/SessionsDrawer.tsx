import { useCallback, useEffect } from "react";
import { MessageSquare, SquarePen } from "lucide-react";
import type { ChatThreadSummary } from "@tellia/shared";
import { useBackButton } from "../../hooks/useBackButton";
import { threadDateLabel, threadLabel } from "../../lib/chatThreads";
import type { AsyncState } from "../../lib/useAsync";
import { font, radius, v } from "../../theme/tokens";

/**
 * Past chat sessions, sliding in from the left over the chat. Mounted only while open, so the
 * Android back button is only intercepted then. The parent must be `position: relative`.
 */
export function SessionsDrawer({
  threads,
  currentId,
  onSelect,
  onNew,
  onClose,
  onRetry,
}: {
  threads: AsyncState<ChatThreadSummary[]>;
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const onBack = useCallback(() => {
    onClose();
    return true;
  }, [onClose]);
  useBackButton(onBack);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const list = threads.data;
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 10, display: "flex" }}>
      <button
        type="button"
        aria-label="Close chat history"
        onClick={onClose}
        data-tf-anim
        style={{ position: "absolute", inset: 0, border: 0, padding: 0, cursor: "pointer", background: "color-mix(in srgb, var(--tf-ink) 48%, transparent)", animation: "tf-scrim-in 180ms ease-out" }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Chat history"
        data-tf-anim
        style={{
          position: "relative",
          width: "min(320px, 84%)",
          height: "100%",
          background: v("bg"),
          borderRight: `1px solid ${v("line")}`,
          display: "flex",
          flexDirection: "column",
          animation: "tf-drawer-in 220ms ease-out",
        }}
      >
        <div style={{ padding: "16px 16px 8px", fontFamily: font.display, fontWeight: 600, fontSize: 24 }}>Chats</div>
        <div style={{ padding: "0 12px 8px" }}>
          <button type="button" onClick={onNew} style={{ ...row, background: v("brand"), color: v("bg"), fontWeight: 600, gap: 10, alignItems: "center", flexDirection: "row" }}>
            <SquarePen size={18} aria-hidden />
            New chat
          </button>
        </div>
        <div role="list" aria-label="Past chats" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 12px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
          {!list && threads.loading && <Note>Loading chats…</Note>}
          {!list && threads.error && (
            <Note>
              Can't load your chats.
              <button type="button" onClick={onRetry} style={{ ...link, marginTop: 8 }}>
                Try again
              </button>
            </Note>
          )}
          {list && list.length === 0 && <Note>No conversations yet. Send a message to start one.</Note>}
          {list?.map((t) => {
            const current = t.id === currentId;
            return (
              <button
                key={t.id}
                type="button"
                role="listitem"
                aria-current={current ? "true" : undefined}
                onClick={() => onSelect(t.id)}
                style={{ ...row, background: current ? v("okSoft") : "transparent", border: `1px solid ${current ? v("brand") : "transparent"}` }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <MessageSquare size={14} aria-hidden style={{ flex: "none", color: v("ink2") }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, fontWeight: current ? 600 : 500 }}>{threadLabel(t.title)}</span>
                </span>
                <span style={{ fontSize: 12, color: v("ink2"), paddingLeft: 22 }}>{threadDateLabel(t.updatedAt)}</span>
              </button>
            );
          })}
          {list && threads.error && <Note>Couldn't refresh the list.</Note>}
        </div>
      </aside>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 8px", fontSize: 13, color: v("ink2"), textAlign: "center" }}>{children}</div>
  );
}

const row: React.CSSProperties = {
  minHeight: 52,
  width: "100%",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: 2,
  padding: "8px 12px",
  borderRadius: radius.tile,
  border: 0,
  color: v("ink"),
  textAlign: "left",
  cursor: "pointer",
};
const link: React.CSSProperties = { minHeight: 44, padding: "0 16px", border: `1px solid ${v("line")}`, borderRadius: radius.pill, background: v("surface"), color: v("ink"), fontSize: 13, cursor: "pointer" };
