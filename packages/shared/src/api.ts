import { z } from "zod";

// ---------------------------------------------------------------------------
// Wire envelope — every API response is one of these two shapes.
// Both sides import these so success/error handling is identical end to end.
// ---------------------------------------------------------------------------

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Wrap a data schema into the standard `{ data: ... }` success envelope. */
export function ok<T extends z.ZodType>(data: T) {
  return z.object({ data });
}

// ---------------------------------------------------------------------------
// Pagination — shared query params + response meta.
// ---------------------------------------------------------------------------

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().min(1).optional(),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export const PageMetaSchema = z.object({
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});
export type PageMeta = z.infer<typeof PageMetaSchema>;

/** `{ data: T[], meta }` — a paginated list response. */
export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    meta: PageMetaSchema,
  });
}

// Common, reusable primitives --------------------------------------------------

export const IdSchema = z.uuid();
export type Id = z.infer<typeof IdSchema>;

export const TimestampsSchema = z.object({
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
