import { z } from "zod";
import { clientEnv } from "../../env";

// The shared API client core. See apps/web/CLAUDE.md §"Mock convention":
// every resource function returns a schema-validated fixture while the real
// endpoint isn't wired, and flips to `http` with a one-line change.

export type ApiMode = "mock" | "live";
export const API_MODE: ApiMode = clientEnv.VITE_API_MODE;

/** Fake latency so mocked screens exercise their loading states. */
export const mockDelay = (ms = 320): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// Identity for live calls. The persona switch sets the selected farm's member;
// the API scopes every irrigation/chat response by the `x-member-id` header.
let memberId: number | null = null;
export const setMemberId = (id: number | null): void => {
  memberId = id;
};

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (memberId != null) h["x-member-id"] = String(memberId);
  return h;
}

async function unwrap<T>(res: Response, schema: z.ZodType<T>): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = (body as { error?: { message?: string } })?.error?.message;
    throw new Error(msg ?? `HTTP ${res.status}`);
  }
  const json = (await res.json()) as { data: unknown };
  return schema.parse(json.data); // fail loud on backend/DB drift
}

export const http = {
  get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return fetch(`${clientEnv.VITE_API_URL}${path}`, { headers: headers() }).then((r) =>
      unwrap(r, schema),
    );
  },
  post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    return fetch(`${clientEnv.VITE_API_URL}${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    }).then((r) => unwrap(r, schema));
  },
};

/** Return a fixture as a mocked response: validated, with fake latency. */
export async function mock<T>(schema: z.ZodType<T>, fixture: unknown): Promise<T> {
  await mockDelay();
  return schema.parse(fixture);
}
