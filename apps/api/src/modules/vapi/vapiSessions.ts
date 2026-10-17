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

/** The customer number of a VAPI SMS conversation, or null when VAPI has none. */
export async function sessionCustomerNumber(
  deps: { privateKey: string; fetch?: typeof fetch },
  sessionId: string,
): Promise<string | null> {
  const res = await (deps.fetch ?? fetch)(`${VAPI_API}/session/${encodeURIComponent(sessionId)}`, {
    headers: { authorization: `Bearer ${deps.privateKey}` },
  });
  if (!res.ok) return null;
  const session = await res.json() as { customer?: { number?: string } };
  return session.customer?.number ?? null;
}

/**
 * Sends `text` as is (no LLM) by SMS from our VAPI number, in a conversation with the assistant
 * (Jean): the farmer can reply by SMS. Ids of the number and the assistant are looked up once.
 */
export function vapiSmsSender(deps: { privateKey: string; fromNumber: string; assistantName: string; fetch?: typeof fetch }) {
  const f = deps.fetch ?? fetch;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await f(`${VAPI_API}${path}`, {
      method,
      headers: { authorization: `Bearer ${deps.privateKey}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`VAPI ${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };
  let ids: Promise<{ phoneNumberId: string; assistantId: string }> | null = null;
  const lookup = async () => {
    const phones = await call("GET", "/phone-number?limit=1000") as { id: string; number?: string }[];
    const assistants = await call("GET", "/assistant?limit=1000") as { id: string; name?: string }[];
    const phone = phones.find((p) => p.number === deps.fromNumber);
    const assistant = assistants.find((a) => a.name === deps.assistantName);
    if (!phone) throw new Error(`VAPI has no phone number ${deps.fromNumber}`);
    if (!assistant) throw new Error(`VAPI has no assistant named ${deps.assistantName}`);
    return { phoneNumberId: phone.id, assistantId: assistant.id };
  };
  return async (to: string, text: string): Promise<void> => {
    ids ??= lookup().catch((e) => {
      ids = null;
      throw e;
    });
    const { phoneNumberId, assistantId } = await ids;
    await call("POST", "/chat", {
      assistantId,
      input: text,
      transport: { type: "twilio.sms", phoneNumberId, customer: { number: to }, useLLMGeneratedMessageForOutbound: false },
    });
  };
}
