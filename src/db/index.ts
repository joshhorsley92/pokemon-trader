import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Netlify's managed Postgres injects NETLIFY_DATABASE_URL at build/runtime;
// self-hosted setups use DATABASE_URL. Accept either so the same code runs
// locally (Docker), on Netlify, and anywhere else.
const connectionString =
  process.env.DATABASE_URL ?? process.env.NETLIFY_DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL (or NETLIFY_DATABASE_URL) is not set");
}

// Supabase pooler (transaction mode, port 6543) does not support prepared
// statements. The client is cached on globalThis so dev-server hot reloads
// reuse one pool instead of leaking connections until Postgres refuses new
// clients.
const globalForDb = globalThis as unknown as {
  __pgClient?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.__pgClient ??
  postgres(connectionString, { prepare: false, max: 5 });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__pgClient = client;
}

export const db = drizzle(client, { schema });
export * as tables from "./schema";
