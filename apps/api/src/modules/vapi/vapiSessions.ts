// VAPI keeps one SMS conversation per caller, with everything Jean already read from the tools,
// "today" included. When the demo date moves, an open conversation would keep answering with the
// old day, so we close them: the next text starts a new conversation and Jean asks the tools
// again. Closing deletes nothing (the messages stay in VAPI). Calls always start fresh.

const VAPI_API = "https://api.vapi.ai";

interface VapiSession {
  id: string;
  status?: string;
  phoneNumberId?: string;
}

/** Closes every open SMS conversation of the VAPI account (one account = this project). */
export async function closeOpenSmsConversations(
  deps: { privateKey: string; fetch?: typeof fetch },
): Promise<number> {
  const f = deps.fetch ?? fetch;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await f(`${VAPI_API}${path}`, {
      method,
      headers: { authorization: `Bearer ${deps.privateKey}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`VAPI ${method} ${path} -> ${res.status}: ${await res.text()}`);
    return res.json();
  };
  const listed = await call("GET", "/session?limit=1000") as
    | VapiSession[]
    | { results?: VapiSession[] };
  const open = (Array.isArray(listed) ? listed : listed.results ?? [])
    .filter((s) => s.status === "active" && s.phoneNumberId);
  for (const s of open) await call("PATCH", `/session/${s.id}`, { status: "completed" });
  return open.length;
}
