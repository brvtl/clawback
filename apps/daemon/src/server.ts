import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { randomBytes } from "crypto";
import { existsSync } from "fs";
import { resolve } from "path";
import { createTestConnection, type DatabaseConnection } from "@clawback/db";
import {
  EventRepository,
  RunRepository,
  NotificationRepository,
  SkillRepository,
  McpServerRepository,
  ScheduledJobRepository,
  WorkflowRepository,
  CheckpointRepository,
  HitlRequestRepository,
  BuilderSessionRepository,
} from "@clawback/db";
import { SkillRegistry } from "./skills/registry.js";
import { SkillExecutor } from "./skills/executor.js";
import { EventQueue } from "./services/queue.js";
import { NotificationService } from "./services/notifications.js";
import { SchedulerService } from "./services/scheduler.js";
import { RemoteSkillFetcher } from "./services/remote-skill-fetcher.js";
import { SkillReviewer } from "./services/skill-reviewer.js";
import { WorkflowExecutor } from "./services/workflow-executor.js";
import { BuilderExecutor } from "./services/builder-executor.js";
import { seedBuilderSkills, getBuilderOrchestratorInstructions } from "./services/builder-seeds.js";
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
  checkpointRepo: CheckpointRepository;
  hitlRequestRepo: HitlRequestRepository;
  skillRegistry: SkillRegistry;
  skillExecutor: SkillExecutor;
  eventQueue: EventQueue;
  notificationService: NotificationService;
  schedulerService: SchedulerService;
  remoteSkillFetcher: RemoteSkillFetcher;
  skillReviewer: SkillReviewer;
  workflowRegistry: WorkflowRegistry;
  workflowExecutor: WorkflowExecutor;
  builderSessionRepo: BuilderSessionRepository;
  builderExecutor: BuilderExecutor;
}

export interface CreateServerOptions extends FastifyServerOptions {
  db?: DatabaseConnection;
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
  mcpServerRepo.seedKnownServers();
  const scheduledJobRepo = new ScheduledJobRepository(db);
  const workflowRepo = new WorkflowRepository(db);
  const checkpointRepo = new CheckpointRepository(db);
  const hitlRequestRepo = new HitlRequestRepository(db);

  // Initialize notification service
  const notificationService = new NotificationService({ enableDesktop: true });

  // Initialize remote skill services
  const remoteSkillFetcher = new RemoteSkillFetcher();
  const skillReviewer = new SkillReviewer({
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Seed Clawback MCP server (builder skills need this)
  let clawbackMcp = mcpServerRepo.findByName("clawback");
  if (!clawbackMcp) {
    const mcpServerPath = existsSync("/app/packages/mcp-server/dist/index.js")
      ? "/app/packages/mcp-server/dist/index.js"
      : resolve(import.meta.dirname, "../../../packages/mcp-server/dist/index.js");
    clawbackMcp = mcpServerRepo.create({
      name: "clawback",
      description: "Clawback API - manages skills, workflows, MCP servers",
      command: "node",
      args: [mcpServerPath],
      env: {},
    });
    console.log(`[Server] Seeded Clawback MCP server: ${clawbackMcp.id}`);
  }

  // Seed builder system skills (before registry load so they're cached)
  const builderSkillMap = seedBuilderSkills(skillRepo);
  const builderSkillIds = Array.from(builderSkillMap.values());
  console.log(`[Server] Builder system skills ready: ${builderSkillIds.length} skills`);

  // Bootstrap system builder workflow
  let builderWorkflow = workflowRepo.findSystem("AI Builder");
  const builderInstructions = getBuilderOrchestratorInstructions(builderSkillMap);
  if (!builderWorkflow) {
    builderWorkflow = workflowRepo.createSystem({
      name: "AI Builder",
      description:
        "System workflow for the AI builder chat. Creates skills, workflows, and MCP servers via conversation.",
      instructions: builderInstructions,
    });
    console.log(`[Server] Created system builder workflow: ${builderWorkflow.id}`);
  } else {
    // Update instructions + skills on every startup (idempotent)
    workflowRepo.update(builderWorkflow.id, {
      instructions: builderInstructions,
      skills: builderSkillIds,
    });
  }

  // Initialize skill registry with database backing
  const skillRegistry = new SkillRegistry(skillRepo);

  // Load skills from database (after seeding so system skills are cached)
  skillRegistry.loadSkills();

  // Initialize scheduler service
  const schedulerService = new SchedulerService({
    scheduledJobRepo,
    skillRepo,
    workflowRepo,
  });

  // Sync scheduled jobs from skills and workflows with cron triggers
  schedulerService.syncJobsFromSkills();
  schedulerService.syncJobsFromWorkflows();

  // Initialize skill executor with remote skill support
  const skillExecutor = new SkillExecutor({
    runRepo,
    notifRepo,
    mcpServerRepo,
    skillRepo,
    remoteSkillFetcher,
    skillReviewer,
    checkpointRepo,
    notificationService,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Initialize workflow registry (after seeding)
  const workflowRegistry = new WorkflowRegistry(workflowRepo);
  workflowRegistry.loadWorkflows();

  // Initialize workflow executor
  const workflowExecutor = new WorkflowExecutor({
    workflowRepo,
    skillRepo,
    eventRepo,
    runRepo,
    skillExecutor,
    checkpointRepo,
    hitlRequestRepo,
    notificationService,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Initialize builder session support
  const builderSessionRepo = new BuilderSessionRepository(db);
  const staleReset = builderSessionRepo.resetStale();
  if (staleReset > 0) {
    console.log(`[Server] Reset ${staleReset} stale builder session(s) to active`);
  }

  const builderExecutor = new BuilderExecutor({
    builderSessionRepo,
    notificationService,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    workflowRepo,
    skillRepo,
    checkpointRepo,
    eventRepo,
    skillExecutor,
    builderWorkflowId: builderWorkflow.id,
    builderSkillIds,
  });

  // Initialize event queue
  const eventQueue = new EventQueue(eventRepo, skillRegistry);

  // Wire scheduler to event queue so cron events get processed
  schedulerService.setEventQueue(eventQueue);

  // Wire up event processing: queue -> skill/workflow executor -> notifications
  eventQueue.onEvent(async (event) => {
    // Parse event payload for filter matching
    const payload =
      typeof event.payload === "string"
        ? (JSON.parse(event.payload) as Record<string, unknown>)
        : event.payload;

    // Special handling for cron-triggered workflows (direct invocation via workflowId in payload)
    if (event.source === "cron" && payload.workflowId) {
      const workflow = workflowRegistry.getWorkflow(payload.workflowId as string);
      if (workflow) {
        try {
          console.log(
            `[Server] Executing cron-triggered workflow "${workflow.name}" for event ${event.id}`
          );
          const workflowRun = await workflowExecutor.execute(workflow, event);

          // If paused for HITL, send info notification instead of success
          if (workflowRun.status === "waiting_for_input") {
            const notif = await notifRepo.create({
              runId: workflowRun.id,
              skillId: workflow.id,
              type: "warning",
              title: `Workflow "${workflow.name}" waiting for input`,
              message: `Workflow is paused and waiting for human input`,
            });
            await notificationService.notify({
              id: notif.id,
              type: "warning",
              title: notif.title,
              message: notif.message,
              skillId: workflow.id,
              runId: workflowRun.id,
            });
            return;
          }

          // Persist notification to database
          const notif = await notifRepo.create({
            runId: workflowRun.id,
            skillId: workflow.id,
            type: "success",
            title: `Workflow "${workflow.name}" completed`,
            message: `Successfully processed scheduled event`,
          });

          // Send real-time notification
          await notificationService.notify({
            id: notif.id,
            type: "success",
            title: notif.title,
            message: notif.message,
            skillId: workflow.id,
            runId: workflowRun.id,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          console.error(`Cron workflow ${workflow.id} failed for event ${event.id}:`, message);

          // Persist error notification to database
          const notif = await notifRepo.create({
            runId: event.id,
            skillId: workflow.id,
            type: "error",
            title: `Workflow "${workflow.name}" failed`,
            message,
          });

          // Send real-time notification
          await notificationService.notify({
            id: notif.id,
            type: "error",
            title: notif.title,
            message: notif.message,
            skillId: workflow.id,
          });
        }
      }
      return; // Don't do normal matching for direct cron workflow invocations
    }

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

        // If paused for HITL, send info notification
        if (workflowRun.status === "waiting_for_input") {
          const notif = await notifRepo.create({
            runId: workflowRun.id,
            skillId: workflow.id,
            type: "warning",
            title: `Workflow "${workflow.name}" waiting for input`,
            message: `Workflow is paused and waiting for human input`,
          });
          await notificationService.notify({
            id: notif.id,
            type: "warning",
            title: notif.title,
            message: notif.message,
            skillId: workflow.id,
            runId: workflowRun.id,
          });
          continue;
        }

        // Persist notification to database
        const notif = await notifRepo.create({
          runId: workflowRun.id,
          skillId: workflow.id,
          type: "success",
          title: `Workflow "${workflow.name}" completed`,
          message: `Successfully processed ${event.type} event`,
        });

        // Send real-time notification
        await notificationService.notify({
          id: notif.id,
          type: "success",
          title: notif.title,
          message: notif.message,
          skillId: workflow.id,
          runId: workflowRun.id,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error(`Workflow ${workflow.id} failed for event ${event.id}:`, message);

        // Persist error notification to database
        const notif = await notifRepo.create({
          runId: event.id, // Use event ID since we don't have a run
          skillId: workflow.id,
          type: "error",
          title: `Workflow "${workflow.name}" failed`,
          message,
        });

        // Send real-time notification
        await notificationService.notify({
          id: notif.id,
          type: "error",
          title: notif.title,
          message: notif.message,
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
    checkpointRepo,
    hitlRequestRepo,
    skillRegistry,
    skillExecutor,
    eventQueue,
    notificationService,
    schedulerService,
    remoteSkillFetcher,
    skillReviewer,
    workflowRegistry,
    workflowExecutor,
    builderSessionRepo,
    builderExecutor,
  };

  // Decorate fastify with context
  server.decorate("context", context);

  // Register routes
  registerWebhookRoutes(server, context);
  registerApiRoutes(server, context);
  registerBuilderRoutes(server, context);

  // Register WebSocket route for real-time notifications
  server.get("/ws", { websocket: true }, (connection) => {
    const clientId = randomBytes(8).toString("hex");
    const ws = (
      connection as unknown as {
        socket: {
          send: (data: string) => void;
          readyState: number;
          on: (event: string, cb: () => void) => void;
        };
      }
    ).socket;

    // Add connection to notification service
    notificationService.addConnection(clientId, ws);

    // Handle connection close
    ws.on("close", () => {
      notificationService.removeConnection(clientId);
    });

    // Handle errors
    ws.on("error", () => {
      notificationService.removeConnection(clientId);
    });

    // Send welcome message
    ws.send(JSON.stringify({ type: "connected", clientId }));
  });

  // Log any workflow runs waiting for human input on startup
  const waitingRuns = workflowRepo.findRunsByStatus("waiting_for_input");
  if (waitingRuns.length > 0) {
    console.log(
      `[Server] Found ${waitingRuns.length} workflow run(s) waiting for human input:`,
      waitingRuns.map((r) => r.id).join(", ")
    );
    const pendingHitl = hitlRequestRepo.findPending();
    if (pendingHitl.length > 0) {
      console.log(`[Server] Pending HITL requests: ${pendingHitl.map((r) => r.id).join(", ")}`);
    }
  }

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
