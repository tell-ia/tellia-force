import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { Loader2, Mic, PanelLeft, Send, Square, SquarePen } from "lucide-react";
import { useFarm } from "../../app/FarmContext";
import { createChatTransport, createThreadId, getChatHistory, listChatThreads, truncateChatThread } from "../../lib/api/chat";
import { canEditMessage, messageText, messagesAfter } from "../../lib/chatEdit";
import { useAsync } from "../../lib/useAsync";
import { font, v } from "../../theme/tokens";
import { SessionsDrawer } from "./SessionsDrawer";
import { EditButton, MessageEditor } from "./MessageEditor";
import { Label } from "../../components/ui/primitives";
import { Markdown } from "../../components/Markdown";
import { WidgetRenderer, type ToolState } from "./WidgetRenderer";
import { useVoiceInput } from "./useVoiceInput";
import { useDragScroll } from "../../hooks/useDragScroll";
import { ScrollTrack } from "../../components/ui/ScrollTrack";

/** Starter questions above the message box: a tap fills the box, the farmer sends. */
const SUGGESTIONS = [
  "Should I water my fields today?",
  "Which field needs water first?",
  "Will it rain this week?",
  "What did I irrigate this week?",
];

export function ChatScreen() {
  const { farm } = useFarm();
  // A persona switch remounts the sessions state: back to that member's latest thread.
  return <ChatSessions key={farm?.memberId ?? "none"} />;
}

function ChatSessions() {
  // `selected`: the thread the farmer picked (null = the member's latest, the server decides).
  // `current`: the thread on screen, reported by LiveChat, to highlight it in the drawer.
  const [selected, setSelected] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const threads = useAsync(listChatThreads, [reload, open], { keepDataOnError: true });
  const close = useCallback(() => setOpen(false), []);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  const startNew = () => {
    const id = createThreadId();
    setSelected(id);
    setCurrent(id);
    setOpen(false);
  };
  const choose = (id: string) => {
    if (id !== current) {
      setSelected(id);
      setCurrent(id);
    }
    setOpen(false);
  };

  return (
    <div style={{ position: "relative", overflow: "hidden", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "12px 12px 10px 8px", display: "flex", alignItems: "center", gap: 4 }}>
        <button type="button" aria-label="Chat history" aria-expanded={open} onClick={() => setOpen(true)} style={headerBtn}>
          <PanelLeft size={22} aria-hidden />
        </button>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", lineHeight: 1.1, paddingLeft: 4 }}>
          <Label>Assistant</Label>
          <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 30 }}>Chat</span>
        </div>
        <button type="button" aria-label="New chat" onClick={startNew} style={headerBtn}>
          <SquarePen size={22} aria-hidden />
        </button>
      </div>
      <LiveChat key={selected ?? "latest"} threadId={selected} onThread={setCurrent} onReplied={refresh} />
      {open && <SessionsDrawer threads={threads} currentId={current} onSelect={choose} onNew={startNew} onClose={close} onRetry={refresh} />}
    </div>
  );
}

// ---- Live chat (Imad's backend) ------------------------------------------

function LiveChat({ threadId, onThread, onReplied }: { threadId: string | null; onThread: (id: string) => void; onReplied: () => void }) {
  // The transport reads the thread on every request; the server's answer (the member's latest)
  // replaces a null choice once the history is in.
  const threadRef = useRef(threadId);
  const transport = useMemo(() => createChatTransport(() => threadRef.current), []);
  const { messages, sendMessage, status, error, setMessages } = useChat({ transport });
  const [offline, setOffline] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getChatHistory(threadId)
      .then((h) => {
        if (!alive) return;
        threadRef.current = h.threadId;
        onThread(h.threadId);
        setMessages(h.messages);
      })
      .catch(() => alive && setOffline(true));
    return () => {
      alive = false;
    };
  }, [threadId, onThread, setMessages]);

  const busy = status === "submitted" || status === "streaming";
  // A finished reply: the thread now exists (or has a newer date), so refresh the drawer list.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) onReplied();
    wasBusy.current = busy;
  }, [busy, onReplied]);
  const reply = (text: string) => sendMessage({ text });
  // Edit a sent message: the server drops it and everything after it, then the new text is sent
  // under the same id (useChat replaces the message and drops the later ones on screen).
  const submitEdit = async (messageId: string, text: string) => {
    setEditError(null);
    try {
      await truncateChatThread(threadRef.current ?? "", messageId);
    } catch (e) {
      setEditError(`Could not edit the message: ${e instanceof Error ? e.message : "try again"}`);
      throw e; // the editor keeps the text
    }
    setEditingId(null);
    void sendMessage({ text, messageId });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  return (
    <ChatLayout
      onSend={reply}
      suggestions={SUGGESTIONS}
      disabled={busy}
      banner={editError ?? (offline ? "Can't reach the advisor — check the connection." : error ? `Error: ${error.message}` : null)}
    >
      {messages.length === 0 && !offline && <Empty />}
      {messages.map((m, i) => (
        <MessageBlock
          key={m.id}
          message={m}
          onReply={reply}
          answered={i < messages.length - 1}
          canEdit={canEditMessage(m, busy)}
          editing={editingId === m.id}
          replaced={messagesAfter(messages, m.id)}
          onEdit={() => {
            setEditError(null);
            setEditingId(m.id);
          }}
          onSubmitEdit={(t) => submitEdit(m.id, t)}
          onCancelEdit={cancelEdit}
        />
      ))}
      {busy && <Typing />}
    </ChatLayout>
  );
}

// ---- rendering -----------------------------------------------------------

interface EditProps {
  canEdit: boolean;
  editing: boolean;
  replaced: number;
  onEdit: () => void;
  onSubmitEdit: (text: string) => Promise<void>;
  onCancelEdit: () => void;
}

function MessageBlock({ message, onReply, answered, canEdit, editing, replaced, onEdit, onSubmitEdit, onCancelEdit }: { message: UIMessage; onReply: (t: string) => void; answered: boolean } & EditProps) {
  const role = message.role === "user" ? "farmer" : "assistant";
  return (
    <Block role={role}>
      {message.parts.map((part, i) => {
        if (part.type === "text" && role === "farmer" && editing) {
          return <MessageEditor key={i} initial={messageText(message)} replaced={replaced} onSubmit={onSubmitEdit} onCancel={onCancelEdit} />;
        }
        if (part.type === "text") return <TextBubble key={i} role={role} text={part.text} />;
        if (part.type.startsWith("tool-")) {
          const tp = part as unknown as { type: string; state: ToolState; output?: unknown };
          return (
            <WidgetRenderer key={i} toolKey={tp.type.slice(5)} state={tp.state} output={tp.output} onReply={onReply} answered={answered} />
          );
        }
        return null;
      })}
      {!editing && canEditMessage(message, false) && <EditButton disabled={!canEdit} onClick={onEdit} />}
    </Block>
  );
}

function Block({ role, children }: { role: "assistant" | "farmer"; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: role === "farmer" ? "flex-end" : "stretch" }}>
      {children}
    </div>
  );
}

/** The advisor's replies render as Markdown; the farmer's own text stays plain. */
function TextBubble({ role, text }: { role: "assistant" | "farmer"; text: string }) {
  const farmer = role === "farmer";
  return (
    <div
      style={{
        alignSelf: farmer ? "flex-end" : "flex-start",
        maxWidth: 300,
        whiteSpace: farmer ? "pre-wrap" : "normal",
        background: farmer ? v("okSoft") : v("surface"),
        border: farmer ? "none" : `1px solid ${v("line")}`,
        color: v("ink"),
        borderRadius: farmer ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
        padding: "10px 12px",
        fontSize: 15,
        lineHeight: 1.45,
      }}
    >
      {farmer ? text : <Markdown text={text} />}
    </div>
  );
}

function ChatLayout({
  children,
  onSend,
  suggestions = [],
  disabled,
  banner,
}: {
  children: React.ReactNode;
  onSend?: (t: string) => void;
  suggestions?: string[];
  disabled?: boolean;
  banner?: string | null;
}) {
  const [input, setInput] = useState("");
  const voice = useVoiceInput(setInput);
  const voiceOn = voice.status !== "idle";
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // While speaking, show the newest words, not the start of a long sentence.
  useEffect(() => {
    const el = inputRef.current;
    if (voiceOn && el) el.scrollLeft = el.scrollWidth;
  }, [voiceOn, input]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  });
  const send = () => {
    const t = input.trim();
    if (!t || !onSend) return;
    onSend(t);
    setInput("");
  };
  return (
    <>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, padding: "6px 14px 10px" }}>
        {children}
        <div ref={endRef} />
      </div>
      {(banner || voice.error) && (
        <div style={{ fontSize: 12, color: v("ink2"), background: v("sunk"), padding: "8px 14px", textAlign: "center" }}>{voice.error ?? banner}</div>
      )}
      {onSend && !input.trim() && !voiceOn && suggestions.length > 0 && (
        <SuggestionChips
          suggestions={suggestions}
          onPick={(s) => {
            setInput(s);
            inputRef.current?.focus();
          }}
        />
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px calc(10px + env(safe-area-inset-bottom))", borderTop: `1px solid ${v("line")}`, background: v("surface") }}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={voiceOn ? "Listening…" : onSend ? "Message" : "Switch to Live to chat"}
          disabled={!onSend}
          readOnly={voiceOn}
          aria-live={voiceOn ? "polite" : undefined}
          style={{ flex: 1, height: 44, borderRadius: 22, border: `1px solid ${v("line")}`, padding: "0 16px", background: v("bg"), color: v("ink"), fontSize: 15 }}
        />
        {input.trim() && !voiceOn ? (
          <button type="submit" aria-label="Send" disabled={disabled} style={iconBtn}>
            <Send size={20} />
          </button>
        ) : (
          <MicButton status={voice.status} disabled={!onSend} onStart={voice.start} onStop={voice.stop} />
        )}
      </form>
    </>
  );
}

/** One sideways-scrolling row: swipe, wheel, drag, or the scrollbar under it. Edges fade where more chips hide. */
function SuggestionChips({ suggestions, onPick }: { suggestions: string[]; onPick: (s: string) => void }) {
  const { ref, edges, metrics } = useDragScroll<HTMLDivElement>();
  const fade = `linear-gradient(to right, ${edges.start ? "transparent" : "#000"}, #000 24px, #000 calc(100% - 24px), ${edges.end ? "transparent" : "#000"})`;
  return (
    <div>
      <div
        ref={ref}
        role="list"
        aria-label="Suggested questions"
        style={{ display: "flex", gap: 8, overflowX: "auto", overscrollBehaviorX: "contain", padding: "8px 12px 0", scrollbarWidth: "none", userSelect: "none", cursor: "grab", maskImage: fade, WebkitMaskImage: fade }}
      >
        {suggestions.map((s) => (
          <button key={s} type="button" role="listitem" onClick={() => onPick(s)} style={chip}>
            {s}
          </button>
        ))}
      </div>
      <ScrollTrack target={ref} metrics={metrics} label="Scroll the suggested questions" />
    </div>
  );
}

/** Tap to talk, tap again to stop. Pulses while it listens. */
function MicButton({
  status,
  disabled,
  onStart,
  onStop,
}: {
  status: ReturnType<typeof useVoiceInput>["status"];
  disabled?: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const listening = status === "listening";
  const waiting = status === "connecting" || status === "finishing";
  return (
    <button
      type="button"
      aria-label={status === "idle" ? "Speak" : listening ? "Stop and keep the text" : status === "connecting" ? "Cancel" : "Finishing"}
      aria-pressed={status !== "idle"}
      onClick={status === "idle" ? onStart : onStop}
      disabled={disabled || status === "finishing"}
      style={{ ...iconBtn, position: "relative", background: listening ? v("act") : v("brand") }}
    >
      {listening && (
        <span data-tf-anim aria-hidden style={{ position: "absolute", inset: 0, borderRadius: 22, background: v("act"), animation: "tf-ripple 1.4s ease-out infinite" }} />
      )}
      {waiting ? (
        <Loader2 size={20} aria-hidden className="animate-spin" />
      ) : listening ? (
        <Square size={16} fill="currentColor" aria-hidden style={{ position: "relative" }} />
      ) : (
        <Mic size={20} aria-hidden />
      )}
    </button>
  );
}

function Typing() {
  return (
    <div style={{ alignSelf: "flex-start", display: "flex", gap: 4, padding: "10px 14px" }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: 7, height: 7, borderRadius: 4, background: v("ink2"), opacity: 0.5 }} />
      ))}
    </div>
  );
}

function Empty() {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, color: v("ink2"), textAlign: "center", padding: 24 }}>
      <div style={{ fontFamily: font.display, fontWeight: 600, fontSize: 20, color: v("ink") }}>Ask the advisor</div>
      <div style={{ fontSize: 13, maxWidth: 260 }}>Pick a question below, type, or tap the mic and speak.</div>
    </div>
  );
}

const chip: React.CSSProperties = { flex: "none", minHeight: 44, borderRadius: 22, border: `1px solid ${v("line")}`, background: v("bg"), color: v("ink"), padding: "0 14px", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" };
const headerBtn: React.CSSProperties = { width: 44, height: 44, flex: "none", borderRadius: 22, border: 0, background: "transparent", color: v("ink"), display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
const iconBtn: React.CSSProperties = { width: 44, height: 44, flex: "none", borderRadius: 22, border: 0, background: v("brand"), color: v("bg"), display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
