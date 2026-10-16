import { z } from "zod";
import {
  type PaginationQuery,
  paginated,
  tableSchemas,
  type TableName,
} from "@tellia/shared";
import { clientEnv } from "../env";

// Typed API client. Every response is parsed with the SHARED zod schema, so the
// front fails loud if the backend/DB ever drifts from the contract.
// The front talks ONLY to the API — never to Supabase directly.

async function getJSON(path: string): Promise<unknown> {
  const res = await fetch(`${clientEnv.VITE_API_URL}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** List rows of a table, validated with its shared schema. Fully typed per table. */
export async function list<T extends TableName>(
  table: T,
  params: Partial<PaginationQuery> = {},
) {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  const schema = paginated(tableSchemas[table]);
  const json = await getJSON(`/data/${table}${qs ? `?${qs}` : ""}`);
  return schema.parse(json) as {
    data: z.infer<(typeof tableSchemas)[T]>[];
    meta: { total: number; limit: number; offset: number };
  };
}

export const api = { list };
