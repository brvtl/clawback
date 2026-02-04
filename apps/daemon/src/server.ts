import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import { createTestConnection, type DatabaseConnection } from "@clawback/db";
import { EventRepository, RunRepository, NotificationRepository } from "@clawback/db";
import { SkillRegistry } from "./skills/registry.js";
import { EventQueue } from "./services/queue.js";
import { registerWebhookRoutes } from "./routes/webhook.js";
import { registerApiRoutes } from "./routes/api.js";

export interface ServerContext {
  db: DatabaseConnection;
  eventRepo: EventRepository;
  runRepo: RunRepository;
  notifRepo: NotificationRepository;
  skillRegistry: SkillRegistry;
  eventQueue: EventQueue;
}

export interface CreateServerOptions extends FastifyServerOptions {
  db?: DatabaseConnection;
  skillsDir?: string;
}

export async function createServer(options: CreateServerOptions = {}): Promise<FastifyInstance> {
  const server = Fastify(options);

  // Register CORS
  await server.register(cors, {
    origin: true,
  });

  // Initialize database (use test connection if none provided)
  const db = options.db ?? createTestConnection();

  // Initialize repositories
  const eventRepo = new EventRepository(db);
  const runRepo = new RunRepository(db);
  const notifRepo = new NotificationRepository(db);

  // Initialize skill registry
  const skillRegistry = new SkillRegistry(options.skillsDir ?? "./skills");

  // Initialize event queue
  const eventQueue = new EventQueue(eventRepo, skillRegistry);

  // Create context
  const context: ServerContext = {
    db,
    eventRepo,
    runRepo,
    notifRepo,
    skillRegistry,
    eventQueue,
  };

  // Decorate fastify with context
  server.decorate("context", context);

  // Register routes
  registerWebhookRoutes(server, context);
  registerApiRoutes(server, context);

  return server;
}

// Type declaration for decorated fastify instance
declare module "fastify" {
  interface FastifyInstance {
    context: ServerContext;
  }
}
