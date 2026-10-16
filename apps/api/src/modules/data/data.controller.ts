import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { type TableName, tableSchemas } from "@tellia/shared/db";
import { PaginationQuerySchema } from "@tellia/shared/api";
import { validate } from "../../core/validate";
import { db } from "../../supabase";

// Generic read access to the Supabase tables, validated with the SHARED schemas.
// The front NEVER talks to Supabase directly — it goes through these routes.
// Add write routes per table as the hackathon needs them (with the right DTO).

// Whitelist = every table we generated a schema for. Nothing else is reachable.
const TABLES = Object.keys(tableSchemas) as TableName[];

const TableParam = z.object({ table: z.enum(TABLES as [string, ...string[]]) });

export const data = new Hono();

// GET /data/:table?limit&offset&q  — list rows (q does a case-insensitive match
// on the first text-ish column when present).
data.get(
  "/:table",
  validate("param", TableParam),
  validate("query", PaginationQuerySchema),
  async (c) => {
    const table = c.req.valid("param").table as TableName;
    const { limit, offset } = c.req.valid("query");
    const { data: rows, count, error } = await db
      .from(table)
      .select("*", { count: "exact" })
      .range(offset, offset + limit - 1);
    if (error) throw new HTTPException(500, { message: error.message });

    const schema = z.array(tableSchemas[table]);
    const parsed = schema.safeParse(rows ?? []);
    if (!parsed.success) {
      // schema drift — surface it loudly instead of shipping bad data
      throw new HTTPException(500, { message: `Schema mismatch on "${table}"` });
    }
    return c.json({ data: parsed.data, meta: { total: count ?? 0, limit, offset } });
  },
);

export { TABLES };
