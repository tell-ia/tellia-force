import { useEffect, useRef, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { editedText, editHint } from "../../lib/chatEdit";
import { v } from "../../theme/tokens";

/** The pencil under a farmer bubble. Subtle, but a 44px target (it overlaps the gap around it). */
export function EditButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Edit message"
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 44,
        height: 44,
        margin: "-12px -8px -12px 0",
        border: 0,
        background: "transparent",
        color: v("ink2"),
        opacity: disabled ? 0.3 : 0.7,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <Pencil size={14} aria-hidden />
    </button>
  );
}

/**
 * Inline editor that replaces a farmer bubble. Enter sends, Shift+Enter adds a line, Escape
 * cancels. `onSubmit` resolves when the edit went through; if it rejects the draft stays here
 * (the screen shows the error in its banner).
 */
export function MessageEditor({
  initial,
  replaced,
  onSubmit,
  onCancel,
}: {
  initial: string;
  /** How many messages after this one the edit replaces. */
  replaced: number;
  onSubmit: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const next = editedText(draft, initial);
  const hint = editHint(replaced);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  // Grow with the text, up to a few lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const submit = async () => {
    if (!next || pending) return;
    setPending(true);
    try {
      await onSubmit(next);
    } catch {
      setPending(false); // keep the draft; the error shows in the banner
    }
  };

  return (
    <div
      style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", gap: 6, background: v("surface"), border: `1px solid ${v("brand")}`, borderRadius: 14, padding: 10 }}
    >
      <textarea
        ref={ref}
        aria-label="Edit your message"
        value={draft}
        rows={2}
        disabled={pending}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        style={{ width: "100%", resize: "none", border: 0, outline: "none", background: "transparent", color: v("ink"), fontSize: 15, lineHeight: 1.45, fontFamily: "inherit" }}
      />
      {hint && <div style={{ fontSize: 12, color: v("ink2") }}>{hint}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" onClick={onCancel} disabled={pending} style={{ ...actionBtn, background: "transparent", color: v("ink"), border: `1px solid ${v("line")}` }}>
          Cancel
        </button>
        <button type="button" onClick={() => void submit()} disabled={!next || pending} style={{ ...actionBtn, background: v("brand"), color: v("bg"), border: 0, opacity: !next || pending ? 0.5 : 1 }}>
          {pending ? <Loader2 size={16} aria-hidden className="animate-spin" /> : "Send"}
        </button>
      </div>
    </div>
  );
}

const actionBtn: React.CSSProperties = { minHeight: 44, minWidth: 72, borderRadius: 22, padding: "0 16px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
