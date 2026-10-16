import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

/** One scripted model turn: tool calls (the model then gets the results) or a final text. */
export type ScriptStep =
  | {
    toolCalls: {
      name: string;
      /** Plain input, or a function of the prompt so far (e.g. to read a runId from a result). */
      input: Record<string, unknown> | ((prompt: unknown[]) => Record<string, unknown>);
    }[];
  }
  | { text: string };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

/**
 * A mock model serving both generate and stream. Every call consumes the next step; once
 * the script runs out it answers "OK.". `prompts` records the prompt of every call.
 */
export function scriptedModel(steps: ScriptStep[]) {
  const prompts: unknown[][] = [];
  let n = 0;
  const next = (prompt: unknown[]) => {
    prompts.push(prompt);
    const step = steps[n++] ?? { text: "OK." };
    if ("text" in step) return { text: step.text, calls: [] as never[] };
    return {
      text: null,
      calls: step.toolCalls.map((c, i) => ({
        toolCallId: `call-${n}-${i}`,
        toolName: c.name,
        input: JSON.stringify(typeof c.input === "function" ? c.input(prompt) : c.input),
      })),
    };
  };
  const model = new MockLanguageModelV3({
    doGenerate: (opts: { prompt: unknown }) => {
      const s = next(opts.prompt as unknown[]);
      const content = s.text !== null
        ? [{ type: "text" as const, text: s.text }]
        : s.calls.map((c) => ({ type: "tool-call" as const, ...c }));
      return Promise.resolve({
        content,
        finishReason: { unified: s.text !== null ? "stop" : "tool-calls", raw: undefined },
        usage,
        warnings: [],
      });
      // deno-lint-ignore no-explicit-any
    },
    doStream: (opts: { prompt: unknown }) => {
      const s = next(opts.prompt as unknown[]);
      // deno-lint-ignore no-explicit-any
      const chunks: any[] = [{ type: "stream-start", warnings: [] }];
      if (s.text !== null) {
        chunks.push(
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: s.text },
          { type: "text-end", id: "t1" },
        );
      } else {
        for (const c of s.calls) chunks.push({ type: "tool-call", ...c });
      }
      chunks.push({
        type: "finish",
        finishReason: { unified: s.text !== null ? "stop" : "tool-calls", raw: undefined },
        usage,
      });
      return Promise.resolve({ stream: simulateReadableStream({ chunks }) });
    },
    // deno-lint-ignore no-explicit-any
  } as any);
  return Object.assign(model, { prompts });
}
