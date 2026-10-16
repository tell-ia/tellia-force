// @tellia/shared — single source of truth for contracts shared by the Deno API
// (apps/api) and the React/Capacitor front (apps/web).
//
// Rule: never redefine a schema on one side. Everything that crosses the wire,
// or that both sides must agree on, lives here as a Zod schema + inferred type.
// Deno imports subpaths via the import map (see apps/api/deno.json); the web app
// imports "@tellia/shared" as a pnpm workspace package.

export * as env from "./env";
export * from "./api";
export * from "./db";
