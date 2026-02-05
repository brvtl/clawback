import type { Config } from "drizzle-kit";

export default {
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    // Path relative to where drizzle-kit is run (packages/db)
    url: process.env.DATABASE_URL ?? "../../clawback.db",
  },
} satisfies Config;
