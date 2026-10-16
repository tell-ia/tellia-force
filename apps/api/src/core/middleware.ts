import { HTTPException } from "hono/http-exception";
import type { ApiError } from "@tellia/shared/api";

/** Map any thrown error to the shared ApiError envelope — one error shape. */
export function onError(err: unknown): Response {
  if (err instanceof HTTPException) {
    const body: ApiError = {
      error: { code: `http_${err.status}`, message: err.message },
    };
    return Response.json(body, { status: err.status });
  }
  console.error("Unhandled error:", err);
  const body: ApiError = {
    error: { code: "internal", message: "Internal server error" },
  };
  return Response.json(body, { status: 500 });
}
