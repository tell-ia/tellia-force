import { useCallback, useEffect, useRef, useState } from "react";
import { connectTranscription, createVoiceSession, type TranscriptionConnection } from "../../lib/api/voice";
import { applyTranscriptEvent, emptyTranscript, isTranscriptCompletion, transcriptText } from "../../lib/transcript";

// Tap the mic → speak → tap again. Words stream into `onText` while the farmer speaks; after the
// stop tap the final transcript lands there too, ready to read over and send.
//
// gpt-live-transcribe has no server VAD: the stop tap commits the audio (one turn per tap).

export type VoiceStatus = "idle" | "connecting" | "listening" | "finishing";

/** Audio still on its way when the farmer taps stop: keep the mic open this long. */
const TAIL_MS = 300;
/** Give up waiting for the final transcript after this. The live text stays. */
const FINAL_TIMEOUT_MS = 5000;
/** Stop by itself after a minute. */
const MAX_LISTEN_MS = 60_000;

/** One tap-to-stop recording. A new tap starts a new run; stale callbacks check `run.current`. */
interface VoiceRun {
  stream?: MediaStream;
  conn?: TranscriptionConnection;
  /** set while waiting for the final transcript */
  onFinal?: () => void;
  timer?: ReturnType<typeof setTimeout>;
}

export function useVoiceInput(onText: (text: string) => void) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const run = useRef<VoiceRun | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });

  const teardown = useCallback(() => {
    const r = run.current;
    run.current = null;
    if (!r) return;
    clearTimeout(r.timer);
    r.stream?.getTracks().forEach((t) => t.stop());
    r.conn?.close();
    setStatus("idle");
  }, []);

  const stop = useCallback(async () => {
    const r = run.current;
    if (!r?.conn) return teardown(); // still connecting: nothing heard yet
    setStatus("finishing");
    clearTimeout(r.timer);
    await new Promise((res) => setTimeout(res, TAIL_MS));
    if (run.current !== r) return;
    await new Promise<void>((resolve) => {
      r.onFinal = resolve;
      r.timer = setTimeout(resolve, FINAL_TIMEOUT_MS);
      r.stream?.getTracks().forEach((t) => t.stop());
      r.conn?.send({ type: "input_audio_buffer.commit" });
    });
    if (run.current === r) teardown();
  }, [teardown]);

  const start = useCallback(async () => {
    if (run.current) return;
    const r: VoiceRun = {};
    run.current = r;
    setError(null);
    setStatus("connecting");
    onTextRef.current("");
    let transcript = emptyTranscript;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This device can't record audio.");
      const [stream, session] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        }),
        createVoiceSession(),
      ]);
      r.stream = stream;
      if (run.current !== r) return void stream.getTracks().forEach((t) => t.stop());
      const conn = await connectTranscription(session, stream, (event) => {
        if (run.current !== r) return;
        const type = (event as { type?: unknown } | null)?.type;
        if (type === "error") {
          // e.g. nothing to commit (silence): end the session, keep what was heard.
          console.warn("voice:", event);
          return r.onFinal?.();
        }
        const next = applyTranscriptEvent(transcript, event);
        if (next !== transcript) {
          transcript = next;
          onTextRef.current(transcriptText(transcript));
        }
        if (isTranscriptCompletion(event)) r.onFinal?.();
      });
      if (run.current !== r) return conn.close();
      r.conn = conn;
      setStatus("listening");
      r.timer = setTimeout(() => void stop(), MAX_LISTEN_MS);
    } catch (e) {
      if (run.current !== r) return;
      const denied = e instanceof DOMException && e.name === "NotAllowedError";
      setError(denied ? "Allow the microphone to talk to the advisor." : "Voice input didn't start. Try again or type.");
      console.warn("voice:", e);
      teardown();
    }
  }, [stop, teardown]);

  useEffect(() => teardown, [teardown]);

  return { status, error, start, stop };
}
