import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import type { ZodType } from "zod";

type Target = "json" | "query" | "param" | "header" | "form";

/** zValidator whose failures go through the ApiError envelope (400 `http_400`). */
export function validate<T extends ZodType, Tg extends Target>(target: Tg, schema: T) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      const message = result.error.issues
        .map((i) => `${i.path.join(".") || target}: ${i.message}`)
        .join("; ");
      throw new HTTPException(400, { message });
    }
  });
}
