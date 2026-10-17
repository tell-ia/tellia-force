import { describe, expect, it } from "vitest";
import { applyTranscriptEvent, emptyTranscript, isTranscriptCompletion, transcriptText, type Transcript } from "./transcript";

const delta = (item_id: string, d: string) => ({ type: "conversation.item.input_audio_transcription.delta", item_id, delta: d });
const done = (item_id: string, transcript: string) => ({ type: "conversation.item.input_audio_transcription.completed", item_id, transcript });
const run = (events: unknown[]): Transcript => events.reduce<Transcript>(applyTranscriptEvent, emptyTranscript);

describe("transcript", () => {
  it("streams deltas, then the final text replaces them", () => {
    const partial = run([delta("a", "Should I"), delta("a", " water Le Puy")]);
    expect(transcriptText(partial)).toBe("Should I water Le Puy");
    expect(transcriptText(applyTranscriptEvent(partial, done("a", "Should I water Le Puits?")))).toBe("Should I water Le Puits?");
  });

  it("keeps items in the order first heard, even when completions swap", () => {
    const t = run([delta("a", "First"), delta("b", "second"), done("b", "second."), done("a", "First,")]);
    expect(transcriptText(t)).toBe("First, second.");
  });

  it("ignores a late delta after the final text", () => {
    expect(transcriptText(run([done("a", "Done."), delta("a", " extra")]))).toBe("Done.");
  });

  it("ignores other events and junk", () => {
    const t = run([{ type: "session.created" }, null, "x", { type: "input_audio_buffer.committed", item_id: "a" }]);
    expect(transcriptText(t)).toBe("");
  });

  it("spots the completion event", () => {
    expect(isTranscriptCompletion(done("a", "x"))).toBe(true);
    expect(isTranscriptCompletion(delta("a", "x"))).toBe(false);
    expect(isTranscriptCompletion(null)).toBe(false);
  });
});
