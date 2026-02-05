import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { randomBytes } from "crypto";
import { createTestConnection, type DatabaseConnection } from "@clawback/db";
import {
  EventRepository,
  RunRepository,
  NotificationRepository,
  SkillRepository,
  McpServerRepository,
} from "@clawback/db";
import { SkillRegistry } from "./skills/registry.js";
import { SkillExecutor, type ClaudeBackend } from "./skills/executor.js";
import { EventQueue } from "./services/queue.js";
import { McpManager } from "./mcp/manager.js";
import { NotificationService } from "./services/notifications.js";
import { registerWebhookRoutes } from "./routes/webhook.js";
import { registerApiRoutes } from "./routes/api.js";

export interface ServerContext {
  db: DatabaseConnection;
  eventRepo: EventRepository;
  runRepo: RunRepository;
  notifRepo: NotificationRepository;
  mcpServerRepo: McpServerRepository;
  skillRegistry: SkillRegistry;
  skillExecutor: SkillExecutor;
  eventQueue: EventQueue;
  mcpManager: McpManager;
  notificationService: NotificationService;
}

export interface CreateServerOptions extends FastifyServerOptions {
  db?: DatabaseConnection;
  skillsDir?: string;
  claudeBackend?: ClaudeBackend;
}

export async function createServer(options: CreateServerOptions = {}): Promise<FastifyInstance> {
  const server = Fastify(options);

  // Register CORS
  await server.register(cors, {
    origin: true,
  });

  // Register WebSocket support
  await server.register(websocket);

  // Initialize database (use test connection if none provided)
  const db = options.db ?? createTestConnection();

  // Initialize repositories
  const eventRepo = new EventRepository(db);
  const runRepo = new RunRepository(db);
  const notifRepo = new NotificationRepository(db);
  const skillRepo = new SkillRepository(db);
  const mcpServerRepo = new McpServerRepository(db);

  // Initialize MCP manager
  const mcpManager = new McpManager();

  // Initialize notification service
  const notificationService = new NotificationService({ enableDesktop: true });

  // Initialize skill registry with database backing
  const skillRegistry = new SkillRegistry(options.skillsDir ?? "./skills", skillRepo);

  // Load skills from database and sync with file system
  await skillRegistry.loadSkills();

  // Initialize skill executor
  const skillExecutor = new SkillExecutor({
    runRepo,
    notifRepo,
    mcpServerRepo,
    mcpManager,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    claudeBackend: options.claudeBackend,
  });

  // Initialize event queue
  const eventQueue = new EventQueue(eventRepo, skillRegistry);

  // Wire up event processing: queue -> skill executor -> notifications
  eventQueue.onEvent(async (event) => {
    // Parse event payload for filter matching
    const payload =
      typeof event.payload === "string"
        ? (JSON.parse(event.payload) as Record<string, unknown>)
        : event.payload;

    // Find matching skills for this event (with payload for filter matching)
    const matches = skillRegistry.findMatchingSkills(event.source, event.type, payload);

    for (const { skill } of matches) {
      try {
        // Execute the skill
        const run = await skillExecutor.execute(skill, event);

        // Send real-time notification if enabled
        if (skill.notifications?.onComplete) {
          await notificationService.notify({
            id: `notif_${run.id}`,
            type: "success",
            title: `${skill.name} completed`,
            message: `Successfully processed ${event.type} event`,
            skillId: skill.id,
            runId: run.id,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error(`Skill ${skill.id} failed for event ${event.id}:`, message);

        // Send error notification if enabled
        if (skill.notifications?.onError) {
          await notificationService.notify({
            id: `notif_err_${event.id}_${skill.id}`,
            type: "error",
            title: `${skill.name} failed`,
            message,
            skillId: skill.id,
          });
        }
      }
    }
  });

  // Create context
  const context: ServerContext = {
    db,
    eventRepo,
    runRepo,
    notifRepo,
    mcpServerRepo,
    skillRegistry,
    skillExecutor,
    eventQueue,
    mcpManager,
    notificationService,
  };

  // Decorate fastify with context
  server.decorate("context", context);

  // Register routes
  registerWebhookRoutes(server, context);
  registerApiRoutes(server, context);

  // Register WebSocket route for real-time notifications
  server.get("/ws", { websocket: true }, (socket) => {
    const clientId = randomBytes(8).toString("hex");

    // Add connection to notification service
    notificationService.addConnection(clientId, socket);

    // Handle connection close
    socket.on("close", () => {
      notificationService.removeConnection(clientId);
    });

    // Handle errors
    socket.on("error", () => {
      notificationService.removeConnection(clientId);
    });

    // Send welcome message
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    socket.send(JSON.stringify({ type: "connected", clientId }));
  });

  return server;
}

// Type declaration for decorated fastify instance
declare module "fastify" {
  interface FastifyInstance {
    context: ServerContext;
  }
}
