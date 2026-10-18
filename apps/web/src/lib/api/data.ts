import { z } from "zod";
import {
  type PaginationQuery,
  paginated,
  tableSchemas,
  type TableName,
} from "@tellia/shared";
import { clientEnv } from "../../env";

// Generic read access to Supabase tables via the API (/data/<table>). The front
// never hits Supabase directly. Every response is parsed with the SHARED schema,
// so the front fails loud if the backend/DB drifts from the contract.

// Table reads are seeded data the app hardly writes (forgetTable after a write): share each one for a minute, so the
// farm list, the day and every parcel report do not fetch /data/field again and again.
const TABLE_TTL_MS = 60_000;
const tables = new Map<string, { at: number; value: Promise<unknown> }>();

function getJSON(path: string): Promise<unknown> {
  const hit = tables.get(path);
  if (hit && Date.now() - hit.at < TABLE_TTL_MS) return hit.value;
  const value = fetchJSON(path);
  tables.set(path, { at: Date.now(), value });
  value.catch(() => {
    if (tables.get(path)?.value === value) tables.delete(path);
  });
  return value;
}

/** Drop a table's shared reads after the app wrote to it (e.g. field outlines uploaded). */
export function forgetTable(table: TableName): void {
  for (const path of [...tables.keys()]) if (path.startsWith(`/data/${table}`)) tables.delete(path);
}

async function fetchJSON(path: string): Promise<unknown> {
  const res = await fetch(`${clientEnv.VITE_API_URL}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`,
    );
  }
  return res.json();
}

/** List rows of a table, validated with its shared schema. Fully typed per table. */
export async function list<T extends TableName>(
  table: T,
  params: Partial<PaginationQuery> = {},
) {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, val]) => [k, String(val)]),
  ).toString();
  const schema = paginated(tableSchemas[table]);
  const json = await getJSON(`/data/${table}${qs ? `?${qs}` : ""}`);
  return schema.parse(json) as {
    data: z.infer<(typeof tableSchemas)[T]>[];
    meta: { total: number; limit: number; offset: number };
  };
}
