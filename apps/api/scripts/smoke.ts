// Real-model smoke test against a running server (`deno task start`). Read-type questions only:
// never asks to record or confirm an irrigation, because that would write to Supabase.
//
//   SMOKE_URL=http://localhost:8123 deno task smoke            # the two default questions
//   SMOKE_URL=... SMOKE_RUNS=3 deno task smoke "question..."   # repeat one question
const base = Deno.env.get("SMOKE_URL") ?? `http://localhost:${Deno.env.get("PORT") ?? "8000"}`;
const runs = Number(Deno.env.get("SMOKE_RUNS") ?? "1");
const questions = Deno.args.length > 0 ? [Deno.args.join(" ")] : [
  "Quel champ dois-je arroser aujourd'hui ?",
  "Et si une sécheresse de 5 jours commence aujourd'hui sur La Vallée ?",
];

async function ask(question: string) {
  const t0 = performance.now();
  const at = () => `${Math.round(performance.now() - t0)} ms`;
  const res = await fetch(`${base}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-member-id": "1" },
    body: JSON.stringify({
      messages: [{
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: question }],
      }],
    }),
  });
  if (!res.ok) throw new Error(`/chat ${res.status}: ${await res.text()}`);
  const msFirstByte = performance.now() - t0;
  let msFirstText = 0;
  let text = "";
  const names = new Map<string, string>();
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const onLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      const ev = JSON.parse(payload);
      if (ev.type === "tool-input-available") {
        names.set(ev.toolCallId, ev.toolName);
        console.log(`  [${at()}] tool call: ${ev.toolName} ${JSON.stringify(ev.input)}`);
      } else if (ev.type === "tool-output-available") {
        console.log(`  [${at()}] tool result: ${names.get(ev.toolCallId) ?? ev.toolCallId}`);
      } else if (ev.type === "text-delta") {
        if (!msFirstText) msFirstText = performance.now() - t0;
        text += ev.delta ?? "";
      }
    } catch { /* partial or non-JSON line */ }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    lines.forEach(onLine);
  }
  if (buf) onLine(buf);
  return { text, msFirstByte, msFirstText, msTotal: performance.now() - t0 };
}

for (const q of questions) {
  for (let i = 1; i <= runs; i++) {
    console.log(`\n> ${q} (run ${i}/${runs})`);
    const r = await ask(q);
    console.log(`  reply: ${r.text}`);
    console.log(
      `  first byte ${Math.round(r.msFirstByte)} ms | first text ${
        Math.round(r.msFirstText)
      } ms | total ${Math.round(r.msTotal)} ms`,
    );
  }
}
