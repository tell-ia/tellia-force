import { Mic, Send } from "lucide-react";
import { font, v } from "../../theme/tokens";
import { Label } from "../../components/ui/primitives";

// Placeholder. Phase 3 wires this to Imad's POST /chat (AI SDK v7 stream) with
// useChat + x-member-id, and renders tool parts as cards (8 tool keys).
export function ChatScreen() {
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 20px 8px", display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <Label>Assistant</Label>
        <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 34 }}>Chat</span>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, textAlign: "center" }}>
        <div style={{ width: 56, height: 56, borderRadius: 28, background: v("sunk"), display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Mic size={24} />
        </div>
        <div style={{ fontFamily: font.display, fontWeight: 600, fontSize: 22 }}>Live in Phase 3</div>
        <div style={{ fontSize: 13, color: v("ink2"), maxWidth: 260 }}>
          The morning brief and voice replies connect to the advisor backend next. The data layer (fixtures → API) is already in place.
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px calc(10px + env(safe-area-inset-bottom))", borderTop: `1px solid ${v("line")}`, background: v("surface") }}>
        <input disabled placeholder="Message" style={{ flex: 1, height: 44, borderRadius: 22, border: `1px solid ${v("line")}`, padding: "0 16px", background: v("bg"), color: v("ink"), fontSize: 15 }} />
        <button type="button" disabled aria-label="Send" style={{ width: 44, height: 44, borderRadius: 22, border: 0, background: v("brand"), color: v("bg"), display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.5 }}>
          <Send size={20} />
        </button>
      </div>
    </div>
  );
}
