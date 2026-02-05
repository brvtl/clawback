import { config } from "dotenv";
import { createServer } from "./server.js";
import { createConnection } from "@clawback/db";
import type { ClaudeBackend } from "./skills/executor.js";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Project root is 3 levels up from src/index.ts (src -> daemon -> apps -> root)
const PROJECT_ROOT = resolve(__dirname, "../../..");

// Load environment variables from project root
// .env.local overrides .env (for local development secrets)
config({ path: join(PROJECT_ROOT, ".env") });
config({ path: join(PROJECT_ROOT, ".env.local"), override: true });

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const DB_PATH = process.env.DATABASE_URL ?? join(PROJECT_ROOT, "clawback.db");
const SKILLS_DIR = process.env.SKILLS_DIR ?? join(PROJECT_ROOT, "skills");
const CLAUDE_BACKEND = (process.env.CLAUDE_BACKEND as ClaudeBackend) ?? "auto";

async function main() {
  // Initialize database
  const db = createConnection(resolve(DB_PATH));

  // Create server
  const server = await createServer({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
    db,
    skillsDir: resolve(SKILLS_DIR),
    claudeBackend: CLAUDE_BACKEND,
  });

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    server.log.info(`Received ${signal}, shutting down...`);
    await server.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Start server
  try {
    await server.listen({ port: PORT, host: HOST });
    server.log.info(`Clawback daemon started on ${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

void main();
