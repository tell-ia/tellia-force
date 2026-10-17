import { VoiceSessionSchema, type VoiceSession } from "@tellia/shared";
import { http } from "./core";

// LIVE: voice input for the chat.
//   POST /voice/session — a short-lived OpenAI key for one transcription session.
// The mic then streams straight to OpenAI over WebRTC; events come back on the data channel.

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export function createVoiceSession(): Promise<VoiceSession> {
  return http.post("/voice/session", {}, VoiceSessionSchema);
}

export interface TranscriptionConnection {
  send(event: { type: string }): void;
  close(): void;
}

/** Opens WebRTC to OpenAI with the mic `stream`; every server event goes to `onEvent`. */
export async function connectTranscription(
  session: VoiceSession,
  stream: MediaStream,
  onEvent: (event: unknown) => void,
): Promise<TranscriptionConnection> {
  const pc = new RTCPeerConnection();
  try {
    for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
    const dc = pc.createDataChannel("oai-events");
    dc.onmessage = (m) => {
      try {
        onEvent(JSON.parse(String(m.data)));
      } catch {
        // not JSON: ignore
      }
    };
    const opened = new Promise<void>((resolve, reject) => {
      dc.onopen = () => resolve();
      dc.onerror = () => reject(new Error("voice channel failed"));
      setTimeout(() => reject(new Error("voice channel timed out")), 10_000);
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const res = await fetch(REALTIME_CALLS_URL, {
      method: "POST",
      body: offer.sdp,
      headers: { Authorization: `Bearer ${session.clientSecret}`, "Content-Type": "application/sdp" },
    });
    if (!res.ok) throw new Error(`voice: HTTP ${res.status}`);
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
    await opened;

    return {
      send: (event) => {
        if (dc.readyState === "open") dc.send(JSON.stringify(event));
      },
      close: () => {
        dc.close();
        pc.close();
      },
    };
  } catch (e) {
    pc.close();
    throw e;
  }
}
