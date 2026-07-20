import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Use the DIRECT (unpooled) connection for migrations, not the pooler.
    // Netlify managed Postgres exposes the NETLIFY_* pair.
    url: (process.env.DIRECT_DATABASE_URL ??
      process.env.NETLIFY_DATABASE_URL_UNPOOLED ??
      process.env.DATABASE_URL ??
      process.env.NETLIFY_DATABASE_URL)!,
  },
});
