import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { Mic, Send } from "lucide-react";
import { useFarm } from "../../app/FarmContext";
import { createChatTransport, getChatHistory } from "../../lib/api/chat";
import { font, radius, v } from "../../theme/tokens";
import { Label } from "../../components/ui/primitives";
import { WidgetRenderer, type ToolState } from "./WidgetRenderer";
import demoConvo from "../../fixtures/oakfield/chat-demo.json";

const MIC_DEMO_PHRASE = "Should I water The Valley?"; // MOCK: voice capture → text

export function ChatScreen() {
  // Default to the offline demo so the screen always works; Live connects to the
  // advisor backend (POST /chat). Phase 3 wires Live; the playground unblocks UI.
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const { farm } = useFarm();

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 20px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <Label>Assistant</Label>
          <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 30 }}>Chat</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, background: v("sunk"), borderRadius: radius.tile, padding: 3 }}>
          <Seg on={mode === "demo"} onClick={() => setMode("demo")}>Demo</Seg>
          <Seg on={mode === "live"} onClick={() => setMode("live")}>Live</Seg>
        </div>
      </div>
      {mode === "demo" ? <DemoChat /> : <LiveChat key={farm?.memberId ?? "none"} />}
    </div>
  );
}

// ---- Live chat (Imad's backend) ------------------------------------------

function LiveChat() {
  const transport = useMemo(() => createChatTransport(), []);
  const { messages, sendMessage, status, error, setMessages } = useChat({ transport });
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    getChatHistory()
      .then((h) => alive && setMessages(h.messages))
      .catch(() => alive && setOffline(true));
    return () => {
      alive = false;
    };
  }, [setMessages]);

  const busy = status === "submitted" || status === "streaming";
  const reply = (text: string) => sendMessage({ text });

  return (
    <ChatLayout
      onSend={reply}
      onMic={() => reply(MIC_DEMO_PHRASE)}
      disabled={busy}
      banner={
        offline
          ? "Backend offline — start the API or use Demo."
          : error
            ? `Error: ${error.message}`
            : null
      }
    >
      {messages.length === 0 && !offline && <Empty />}
      {messages.map((m) => (
        <MessageBlock key={m.id} message={m} onReply={reply} />
      ))}
      {busy && <Typing />}
    </ChatLayout>
  );
}

// ---- Demo chat (scripted, offline) ---------------------------------------

interface DemoPart {
  type: "text" | "widget";
  text?: string;
  key?: string;
  output?: unknown;
}
interface DemoMessage {
  role: "assistant" | "farmer";
  parts: DemoPart[];
}

function DemoChat() {
  const convo = demoConvo as { messages: DemoMessage[] };
  return (
    <ChatLayout disabled banner="Scripted demo — switch to Live to chat with the backend.">
      {convo.messages.map((m, i) => (
        <Block key={i} role={m.role}>
          {m.parts.map((p, j) =>
            p.type === "text" ? (
              <TextBubble key={j} role={m.role}>{p.text}</TextBubble>
            ) : (
              <WidgetRenderer key={j} toolKey={p.key ?? ""} state="output-available" output={p.output} />
            ),
          )}
        </Block>
      ))}
    </ChatLayout>
  );
}

// ---- rendering shared by both --------------------------------------------

function MessageBlock({ message, onReply }: { message: UIMessage; onReply: (t: string) => void }) {
  const role = message.role === "user" ? "farmer" : "assistant";
  return (
    <Block role={role}>
      {message.parts.map((part, i) => {
        if (part.type === "text") return <TextBubble key={i} role={role}>{part.text}</TextBubble>;
        if (part.type.startsWith("tool-")) {
          const tp = part as unknown as { type: string; state: ToolState; output?: unknown };
          return (
            <WidgetRenderer key={i} toolKey={tp.type.slice(5)} state={tp.state} output={tp.output} onReply={onReply} />
          );
        }
        return null;
      })}
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

function TextBubble({ role, children }: { role: "assistant" | "farmer"; children: React.ReactNode }) {
  const farmer = role === "farmer";
  return (
    <div
      style={{
        alignSelf: farmer ? "flex-end" : "flex-start",
        maxWidth: 300,
        whiteSpace: "pre-wrap",
        background: farmer ? v("okSoft") : v("surface"),
        border: farmer ? "none" : `1px solid ${v("line")}`,
        color: v("ink"),
        borderRadius: farmer ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
        padding: "10px 12px",
        fontSize: 15,
        lineHeight: 1.45,
      }}
    >
      {children}
    </div>
  );
}

function ChatLayout({
  children,
  onSend,
  onMic,
  disabled,
  banner,
}: {
  children: React.ReactNode;
  onSend?: (t: string) => void;
  onMic?: () => void;
  disabled?: boolean;
  banner?: string | null;
}) {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
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
      {banner && (
        <div style={{ fontSize: 12, color: v("ink2"), background: v("sunk"), padding: "8px 14px", textAlign: "center" }}>{banner}</div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px calc(10px + env(safe-area-inset-bottom))", borderTop: `1px solid ${v("line")}`, background: v("surface") }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={onSend ? "Message" : "Switch to Live to chat"}
          disabled={!onSend}
          style={{ flex: 1, height: 44, borderRadius: 22, border: `1px solid ${v("line")}`, padding: "0 16px", background: v("bg"), color: v("ink"), fontSize: 15 }}
        />
        {input.trim() ? (
          <button type="submit" aria-label="Send" disabled={disabled} style={iconBtn}>
            <Send size={20} />
          </button>
        ) : (
          <button type="button" aria-label="Hold to speak" onClick={onMic} disabled={!onMic || disabled} style={iconBtn}>
            <Mic size={20} />
          </button>
        )}
      </form>
    </>
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
      <div style={{ fontSize: 13, maxWidth: 260 }}>“Should I water The Valley?” · tap the mic to try it.</div>
    </div>
  );
}

function Seg({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} style={{ minWidth: 60, height: 34, border: 0, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", background: on ? v("surface") : "transparent", color: on ? v("ink") : v("ink2"), boxShadow: on ? "0 1px 2px rgba(15, 24, 19, 0.12)" : "none" }}>{children}</button>
  );
}

const iconBtn: React.CSSProperties = { width: 44, height: 44, flex: "none", borderRadius: 22, border: 0, background: v("brand"), color: v("bg"), display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
