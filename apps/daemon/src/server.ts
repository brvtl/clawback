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
  ScheduledJobRepository,
  WorkflowRepository,
} from "@clawback/db";
import { SkillRegistry } from "./skills/registry.js";
import { SkillExecutor } from "./skills/executor.js";
import { EventQueue } from "./services/queue.js";
import { McpManager } from "./mcp/manager.js";
import { NotificationService } from "./services/notifications.js";
import { SchedulerService } from "./services/scheduler.js";
import { RemoteSkillFetcher } from "./services/remote-skill-fetcher.js";
import { SkillReviewer } from "./services/skill-reviewer.js";
import { WorkflowExecutor } from "./services/workflow-executor.js";
import { WorkflowRegistry } from "./workflows/registry.js";
import { registerWebhookRoutes } from "./routes/webhook.js";
import { registerApiRoutes } from "./routes/api.js";
import { registerBuilderRoutes } from "./routes/builder.js";

export interface ServerContext {
  db: DatabaseConnection;
  eventRepo: EventRepository;
  runRepo: RunRepository;
  notifRepo: NotificationRepository;
  mcpServerRepo: McpServerRepository;
  scheduledJobRepo: ScheduledJobRepository;
  workflowRepo: WorkflowRepository;
  skillRegistry: SkillRegistry;
  skillExecutor: SkillExecutor;
  eventQueue: EventQueue;
  mcpManager: McpManager;
  notificationService: NotificationService;
  schedulerService: SchedulerService;
  remoteSkillFetcher: RemoteSkillFetcher;
  skillReviewer: SkillReviewer;
  workflowRegistry: WorkflowRegistry;
  workflowExecutor: WorkflowExecutor;
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
  const scheduledJobRepo = new ScheduledJobRepository(db);
  const workflowRepo = new WorkflowRepository(db);

  // Initialize MCP manager
  const mcpManager = new McpManager();

  // Initialize notification service
  const notificationService = new NotificationService({ enableDesktop: true });

  // Initialize remote skill services
  const remoteSkillFetcher = new RemoteSkillFetcher();
  const skillReviewer = new SkillReviewer({
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Initialize skill registry with database backing
  const skillRegistry = new SkillRegistry(options.skillsDir ?? "./skills", skillRepo);

  // Load skills from database and sync with file system
  await skillRegistry.loadSkills();

  // Initialize scheduler service
  const schedulerService = new SchedulerService({
    scheduledJobRepo,
    skillRepo,
    eventRepo,
  });

  // Sync scheduled jobs from skills with cron triggers
  schedulerService.syncJobsFromSkills();

  // Initialize skill executor with remote skill support
  const skillExecutor = new SkillExecutor({
    runRepo,
    notifRepo,
    mcpServerRepo,
    mcpManager,
    skillRepo,
    remoteSkillFetcher,
    skillReviewer,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Initialize workflow registry
  const workflowRegistry = new WorkflowRegistry(workflowRepo);
  workflowRegistry.loadWorkflows();

  // Initialize workflow executor
  const workflowExecutor = new WorkflowExecutor({
    workflowRepo,
    skillRepo,
    eventRepo,
    runRepo,
    skillExecutor,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Initialize event queue
  const eventQueue = new EventQueue(eventRepo, skillRegistry);

  // Wire up event processing: queue -> skill/workflow executor -> notifications
  eventQueue.onEvent(async (event) => {
    // Parse event payload for filter matching
    const payload =
      typeof event.payload === "string"
        ? (JSON.parse(event.payload) as Record<string, unknown>)
        : event.payload;

    // Find matching workflows for this event
    const workflowMatches = workflowRegistry.findMatchingWorkflows(
      event.source,
      event.type,
      payload
    );

    for (const { workflow } of workflowMatches) {
      try {
        console.log(`[Server] Executing workflow "${workflow.name}" for event ${event.id}`);
        const workflowRun = await workflowExecutor.execute(workflow, event);

        await notificationService.notify({
          id: `notif_wf_${workflowRun.id}`,
          type: "success",
          title: `Workflow "${workflow.name}" completed`,
          message: `Successfully processed ${event.type} event`,
          skillId: workflow.id,
          runId: workflowRun.id,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error(`Workflow ${workflow.id} failed for event ${event.id}:`, message);

        await notificationService.notify({
          id: `notif_wf_err_${event.id}_${workflow.id}`,
          type: "error",
          title: `Workflow "${workflow.name}" failed`,
          message,
          skillId: workflow.id,
        });
      }
    }

    // Find matching skills for this event (with payload for filter matching)
    const skillMatches = skillRegistry.findMatchingSkills(event.source, event.type, payload);

    for (const { skill } of skillMatches) {
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
    scheduledJobRepo,
    workflowRepo,
    skillRegistry,
    skillExecutor,
    eventQueue,
    mcpManager,
    notificationService,
    schedulerService,
    remoteSkillFetcher,
    skillReviewer,
    workflowRegistry,
    workflowExecutor,
  };

  // Decorate fastify with context
  server.decorate("context", context);

  // Register routes
  registerWebhookRoutes(server, context);
  registerApiRoutes(server, context);
  registerBuilderRoutes(server, context);

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

  // Start the scheduler
  schedulerService.start();

  // Stop scheduler on server close
  server.addHook("onClose", () => {
    schedulerService.stop();
  });

  return server;
}

// Type declaration for decorated fastify instance
declare module "fastify" {
  interface FastifyInstance {
    context: ServerContext;
  }
}
