import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ServerContext } from "../server.js";
import { validateMcpServerEnv, fixMcpServerEnv } from "@clawback/shared";

const VERSION = "0.1.0";

interface ListParams {
  limit?: number;
  offset?: number;
}

export function registerApiRoutes(server: FastifyInstance, context: ServerContext): void {
  // Status endpoint
  server.get("/api/status", async (_request: FastifyRequest, reply: FastifyReply) => {
    const skills = context.skillRegistry.listSkills();
    return reply.send({
      status: "ok",
      version: VERSION,
      skills: skills.length,
      uptime: process.uptime(),
    });
  });

  // List events
  server.get<{ Querystring: ListParams }>(
    "/api/events",
    async (request: FastifyRequest<{ Querystring: ListParams }>, reply: FastifyReply) => {
      const { limit = 50, offset = 0 } = request.query;
      const events = await context.eventRepo.list({ limit, offset });
      return reply.send({ events });
    }
  );

  // Get event by ID
  server.get<{ Params: { id: string } }>(
    "/api/events/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const event = await context.eventRepo.findById(request.params.id);
      if (!event) {
        return reply.status(404).send({ error: "Event not found" });
      }
      const runs = await context.runRepo.findByEvent(event.id);
      return reply.send({ event, runs });
    }
  );

  // List skills
  server.get("/api/skills", async (_request: FastifyRequest, reply: FastifyReply) => {
    const skills = context.skillRegistry.listSkills();
    return reply.send({ skills });
  });

  // Create skill
  server.post("/api/skills", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      name: string;
      description?: string;
      instructions: string;
      triggers: Array<{
        source: string;
        events?: string[];
        schedule?: string;
        filters?: { repository?: string; ref?: string[] };
      }>;
      mcpServers?: Record<
        string,
        { command: string; args?: string[]; env?: Record<string, string> }
      >;
      toolPermissions?: { allow?: string[]; deny?: string[] };
      notifications?: { onComplete?: boolean; onError?: boolean };
      knowledge?: string[];
      model?: "opus" | "sonnet" | "haiku";
    };

    const skill = context.skillRegistry.registerSkill({
      id: "", // Will be generated
      name: body.name,
      description: body.description,
      instructions: body.instructions,
      triggers: body.triggers,
      mcpServers: body.mcpServers ?? {},
      toolPermissions: body.toolPermissions ?? { allow: ["*"], deny: [] },
      notifications: body.notifications ?? { onComplete: false, onError: true },
      knowledge: body.knowledge,
      model: body.model ?? "sonnet",
    });

    // Sync scheduled jobs if skill has cron triggers
    const hasCronTrigger = skill.triggers.some((t) => t.source === "cron" && t.schedule);
    if (hasCronTrigger) {
      context.schedulerService.syncJobsFromSkills();
    }

    return reply.status(201).send({ skill });
  });

  // Import remote skill from URL
  server.post("/api/skills/remote", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      sourceUrl: string;
      name?: string;
    };

    if (!body.sourceUrl) {
      return reply.status(400).send({ error: "sourceUrl is required" });
    }

    // Validate URL
    const urlValidation = context.remoteSkillFetcher.validateUrl(body.sourceUrl);
    if (!urlValidation.valid) {
      return reply.status(400).send({ error: urlValidation.error });
    }

    try {
      // Fetch the skill
      const fetched = await context.remoteSkillFetcher.fetch(body.sourceUrl);

      // Run AI review
      let knowledgeContent: string | undefined;
      if (fetched.knowledgeFiles.size > 0) {
        knowledgeContent = Array.from(fetched.knowledgeFiles.entries())
          .map(([path, content]) => `### ${path}\n${content}`)
          .join("\n\n");
      }

      const reviewResult = await context.skillReviewer.review(fetched.contentHash, {
        instructions: fetched.skillMarkdown.instructions,
        knowledgeContent,
        toolPermissions: fetched.skillMarkdown.toolPermissions,
        mcpServers: fetched.skillMarkdown.mcpServers
          ? Array.isArray(fetched.skillMarkdown.mcpServers)
            ? fetched.skillMarkdown.mcpServers
            : Object.keys(fetched.skillMarkdown.mcpServers)
          : undefined,
      });

      // Create the skill with review status
      const skill = context.skillRegistry.registerSkill({
        id: "", // Will be generated
        name: body.name ?? fetched.skillMarkdown.name ?? "Remote Skill",
        description: fetched.skillMarkdown.description,
        instructions: fetched.skillMarkdown.instructions,
        triggers: fetched.skillMarkdown.triggers,
        mcpServers: fetched.skillMarkdown.mcpServers ?? {},
        toolPermissions: { allow: ["Read", "Glob", "Grep", "WebFetch", "WebSearch"], deny: [] },
        notifications: fetched.skillMarkdown.notifications ?? { onComplete: false, onError: true },
        knowledge: fetched.skillMarkdown.knowledge,
        sourceUrl: body.sourceUrl,
        isRemote: true,
        contentHash: fetched.contentHash,
        reviewStatus: reviewResult.approved ? "approved" : "rejected",
        reviewResult,
      });

      // Sync scheduled jobs if skill has cron triggers
      const hasCronTrigger = skill.triggers.some((t) => t.source === "cron" && t.schedule);
      if (hasCronTrigger) {
        context.schedulerService.syncJobsFromSkills();
      }

      return reply.status(201).send({
        skill,
        reviewResult,
        warnings: reviewResult.approved ? undefined : reviewResult.concerns,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to import remote skill";
      return reply.status(400).send({ error: message });
    }
  });

  // Manually trigger re-review for a remote skill
  server.post<{ Params: { id: string } }>(
    "/api/skills/:id/review",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const skill = context.skillRegistry.getSkill(request.params.id);
      if (!skill) {
        return reply.status(404).send({ error: "Skill not found" });
      }

      if (!skill.isRemote || !skill.sourceUrl) {
        return reply.status(400).send({ error: "Only remote skills can be reviewed" });
      }

      try {
        // Fetch fresh content
        const fetched = await context.remoteSkillFetcher.fetch(skill.sourceUrl);

        // Build knowledge content
        let knowledgeContent: string | undefined;
        if (fetched.knowledgeFiles.size > 0) {
          knowledgeContent = Array.from(fetched.knowledgeFiles.entries())
            .map(([path, content]) => `### ${path}\n${content}`)
            .join("\n\n");
        }

        // Clear cache and run fresh review
        context.skillReviewer.clearCache();
        const reviewResult = await context.skillReviewer.review(fetched.contentHash, {
          instructions: fetched.skillMarkdown.instructions,
          knowledgeContent,
          toolPermissions: skill.toolPermissions,
        });

        // Update skill with new review
        const updatedSkill = context.skillRegistry.updateSkill(skill.id, {
          contentHash: fetched.contentHash,
          reviewStatus: reviewResult.approved ? "approved" : "rejected",
          reviewResult,
        });

        return reply.send({
          skill: updatedSkill,
          reviewResult,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Review failed";
        return reply.status(400).send({ error: message });
      }
    }
  );

  // Get skill by ID
  server.get<{ Params: { id: string } }>(
    "/api/skills/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const skill = context.skillRegistry.getSkill(request.params.id);
      if (!skill) {
        return reply.status(404).send({ error: "Skill not found" });
      }
      return reply.send({ skill });
    }
  );

  // Update skill
  server.put<{ Params: { id: string } }>(
    "/api/skills/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const existing = context.skillRegistry.getSkill(request.params.id);
      if (!existing) {
        return reply.status(404).send({ error: "Skill not found" });
      }

      const body = request.body as {
        name?: string;
        description?: string;
        instructions?: string;
        triggers?: Array<{
          source: string;
          events?: string[];
          schedule?: string;
          filters?: { repository?: string; ref?: string[] };
        }>;
        mcpServers?: Record<
          string,
          { command: string; args?: string[]; env?: Record<string, string> }
        >;
        toolPermissions?: { allow?: string[]; deny?: string[] };
        notifications?: { onComplete?: boolean; onError?: boolean };
        knowledge?: string[];
        model?: "opus" | "sonnet" | "haiku";
      };

      const skill = context.skillRegistry.updateSkill(request.params.id, {
        name: body.name,
        description: body.description,
        instructions: body.instructions,
        triggers: body.triggers,
        mcpServers: body.mcpServers,
        toolPermissions: body.toolPermissions,
        notifications: body.notifications,
        knowledge: body.knowledge,
        model: body.model,
      });

      if (!skill) {
        return reply.status(404).send({ error: "Skill not found" });
      }

      // Sync scheduled jobs if skill has cron triggers
      const hasCronTrigger = skill.triggers.some((t) => t.source === "cron" && t.schedule);
      if (hasCronTrigger) {
        context.schedulerService.syncJobsFromSkills();
      }

      return reply.send({ skill });
    }
  );

  // Delete skill
  server.delete<{ Params: { id: string } }>(
    "/api/skills/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const deleted = context.skillRegistry.deleteSkill(request.params.id);
      if (!deleted) {
        return reply.status(404).send({ error: "Skill not found" });
      }
      return reply.send({ success: true });
    }
  );

  // List runs
  server.get<{ Querystring: ListParams & { skillId?: string } }>(
    "/api/runs",
    async (
      request: FastifyRequest<{ Querystring: ListParams & { skillId?: string } }>,
      reply: FastifyReply
    ) => {
      const { limit = 50, offset = 0, skillId } = request.query;
      const runs = await context.runRepo.list({ limit, offset, skillId });
      return reply.send({ runs });
    }
  );

  // Get run by ID
  server.get<{ Params: { id: string } }>(
    "/api/runs/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const run = await context.runRepo.findById(request.params.id);
      if (!run) {
        return reply.status(404).send({ error: "Run not found" });
      }
      return reply.send({ run });
    }
  );

  // List notifications
  server.get<{ Querystring: ListParams }>(
    "/api/notifications",
    async (request: FastifyRequest<{ Querystring: ListParams }>, reply: FastifyReply) => {
      const { limit = 50, offset = 0 } = request.query;
      const notifications = await context.notifRepo.list({ limit, offset });
      const unreadCount = (await context.notifRepo.findUnread()).length;
      return reply.send({ notifications, unreadCount });
    }
  );

  // Mark notification as read
  server.post<{ Params: { id: string } }>(
    "/api/notifications/:id/read",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      await context.notifRepo.markRead(request.params.id);
      return reply.send({ success: true });
    }
  );

  // Mark all notifications as read
  server.post(
    "/api/notifications/read-all",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      await context.notifRepo.markAllRead();
      return reply.send({ success: true });
    }
  );

  // ======================
  // MCP Server Endpoints
  // ======================

  // List MCP servers
  server.get("/api/mcp-servers", async (_request: FastifyRequest, reply: FastifyReply) => {
    const servers = context.mcpServerRepo.findAll();
    // Mask sensitive env values
    const maskedServers = servers.map((s) => ({
      ...s,
      env: Object.fromEntries(Object.entries(s.env).map(([k, v]) => [k, v ? "••••••••" : ""])),
    }));
    return reply.send({ servers: maskedServers });
  });

  // Get MCP server by ID
  server.get<{ Params: { id: string } }>(
    "/api/mcp-servers/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const server = context.mcpServerRepo.findById(request.params.id);
      if (!server) {
        return reply.status(404).send({ error: "MCP server not found" });
      }
      // Mask sensitive env values
      const maskedServer = {
        ...server,
        env: Object.fromEntries(
          Object.entries(server.env).map(([k, v]) => [k, v ? "••••••••" : ""])
        ),
      };
      return reply.send({ server: maskedServer });
    }
  );

  // Create MCP server
  server.post("/api/mcp-servers", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      name: string;
      description?: string;
      command: string;
      args?: string[] | string;
      env?: Record<string, string>;
    };

    // Check for duplicate name
    const existing = context.mcpServerRepo.findByName(body.name);
    if (existing) {
      return reply
        .status(400)
        .send({ error: `MCP server with name "${body.name}" already exists` });
    }

    // Normalize args to array (handle string input from builder)
    let args: string[];
    if (typeof body.args === "string") {
      args = body.args.trim() ? body.args.trim().split(/\s+/) : [];
    } else {
      args = body.args ?? [];
    }

    // Validate and auto-fix env vars for known MCP server types
    let env = body.env ?? {};
    const validation = validateMcpServerEnv(args, env);
    if (!validation.valid && Object.keys(validation.suggestions).length > 0) {
      // Auto-fix common mistakes
      env = fixMcpServerEnv(args, env);
      console.log(`[API] Auto-fixed MCP server env vars:`, validation.suggestions);
    }

    const server = context.mcpServerRepo.create({
      name: body.name,
      description: body.description,
      command: body.command,
      args,
      env,
    });

    // Include warnings in response if any
    return reply.status(201).send({
      server,
      warnings: validation.warnings.length > 0 ? validation.warnings : undefined,
    });
  });

  // Update MCP server
  server.put<{ Params: { id: string } }>(
    "/api/mcp-servers/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const existing = context.mcpServerRepo.findById(request.params.id);
      if (!existing) {
        return reply.status(404).send({ error: "MCP server not found" });
      }

      const body = request.body as {
        name?: string;
        description?: string;
        command?: string;
        args?: string[] | string;
        env?: Record<string, string>;
        enabled?: boolean;
      };

      // If updating name, check for duplicates
      if (body.name && body.name !== existing.name) {
        const duplicate = context.mcpServerRepo.findByName(body.name);
        if (duplicate) {
          return reply
            .status(400)
            .send({ error: `MCP server with name "${body.name}" already exists` });
        }
      }

      // Normalize args to array (handle string input from builder)
      let args: string[];
      if (typeof body.args === "string") {
        args = body.args.trim() ? body.args.trim().split(/\s+/) : [];
      } else {
        args = body.args ?? existing.args;
      }

      // Validate and auto-fix env vars for known MCP server types
      let env = body.env;
      let warnings: string[] = [];
      if (env) {
        const validation = validateMcpServerEnv(args, env);
        warnings = validation.warnings;
        if (!validation.valid && Object.keys(validation.suggestions).length > 0) {
          // Auto-fix common mistakes
          env = fixMcpServerEnv(args, env);
          console.log(`[API] Auto-fixed MCP server env vars:`, validation.suggestions);
        }
      }

      const updated = context.mcpServerRepo.update(request.params.id, {
        ...body,
        args,
        env,
      });

      return reply.send({
        server: updated,
        warnings: warnings.length > 0 ? warnings : undefined,
      });
    }
  );

  // Delete MCP server
  server.delete<{ Params: { id: string } }>(
    "/api/mcp-servers/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const deleted = context.mcpServerRepo.delete(request.params.id);
      if (!deleted) {
        return reply.status(404).send({ error: "MCP server not found" });
      }
      return reply.send({ success: true });
    }
  );

  // ======================
  // Scheduled Jobs Endpoints
  // ======================

  // List scheduled jobs
  server.get("/api/scheduled-jobs", async (_request: FastifyRequest, reply: FastifyReply) => {
    const jobs = context.scheduledJobRepo.findAllEnriched();

    // Add formatted timestamps
    const enrichedJobs = jobs.map((job) => {
      return {
        ...job,
        nextRunFormatted: new Date(job.nextRunAt).toISOString(),
        lastRunFormatted: job.lastRunAt ? new Date(job.lastRunAt).toISOString() : null,
      };
    });

    return reply.send({ jobs: enrichedJobs });
  });

  // Get scheduled job by ID
  server.get<{ Params: { id: string } }>(
    "/api/scheduled-jobs/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const job = context.scheduledJobRepo.findById(request.params.id);
      if (!job) {
        return reply.status(404).send({ error: "Scheduled job not found" });
      }

      // Get skill or workflow name
      let skillName: string | undefined;
      let workflowName: string | undefined;
      if (job.skillId) {
        const skill = context.skillRegistry.getSkill(job.skillId);
        skillName = skill?.name;
      }
      if (job.workflowId) {
        const workflow = context.workflowRegistry.getWorkflow(job.workflowId);
        workflowName = workflow?.name;
      }

      const nextRuns = context.schedulerService.getNextRuns(job.schedule, 5);

      return reply.send({
        job: {
          ...job,
          skillName,
          workflowName,
          nextRunFormatted: new Date(job.nextRunAt).toISOString(),
          lastRunFormatted: job.lastRunAt ? new Date(job.lastRunAt).toISOString() : null,
        },
        upcomingRuns: nextRuns.map((d) => d.toISOString()),
      });
    }
  );

  // Enable/disable scheduled job
  server.patch<{ Params: { id: string } }>(
    "/api/scheduled-jobs/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const body = request.body as { enabled?: boolean };

      const job = context.scheduledJobRepo.findById(request.params.id);
      if (!job) {
        return reply.status(404).send({ error: "Scheduled job not found" });
      }

      if (body.enabled !== undefined) {
        context.scheduledJobRepo.setEnabled(request.params.id, body.enabled);
      }

      const updated = context.scheduledJobRepo.findById(request.params.id);
      return reply.send({ job: updated });
    }
  );

  // Validate cron expression
  server.post(
    "/api/scheduled-jobs/validate",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { schedule: string };

      if (!body.schedule) {
        return reply.status(400).send({ error: "schedule is required" });
      }

      const validation = context.schedulerService.validateSchedule(body.schedule);
      if (!validation.valid) {
        return reply.status(400).send({ valid: false, error: validation.error });
      }

      const nextRuns = context.schedulerService.getNextRuns(body.schedule, 5);
      return reply.send({
        valid: true,
        upcomingRuns: nextRuns.map((d) => d.toISOString()),
      });
    }
  );

  // ======================
  // Workflow Endpoints
  // ======================

  // List workflows
  server.get("/api/workflows", async (_request: FastifyRequest, reply: FastifyReply) => {
    const workflows = context.workflowRegistry.listWorkflows();
    return reply.send({ workflows });
  });

  // Get workflow by ID
  server.get<{ Params: { id: string } }>(
    "/api/workflows/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const workflow = context.workflowRegistry.getWorkflow(request.params.id);
      if (!workflow) {
        return reply.status(404).send({ error: "Workflow not found" });
      }

      // Get associated skills
      const skills = workflow.skills
        .map((skillId) => context.skillRegistry.getSkill(skillId))
        .filter(Boolean);

      return reply.send({ workflow, skills });
    }
  );

  // Create workflow
  server.post("/api/workflows", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      name: string;
      description?: string;
      instructions: string;
      triggers: Array<{
        source: string;
        events?: string[];
        schedule?: string;
        filters?: { repository?: string; ref?: string[] };
      }>;
      skills: string[];
      orchestratorModel?: "opus" | "sonnet";
    };

    if (!body.name || !body.instructions || !body.triggers || !body.skills) {
      return reply.status(400).send({
        error: "name, instructions, triggers, and skills are required",
      });
    }

    // Validate that referenced skills exist
    const invalidSkills = body.skills.filter((id) => !context.skillRegistry.getSkill(id));
    if (invalidSkills.length > 0) {
      return reply.status(400).send({
        error: `Skills not found: ${invalidSkills.join(", ")}`,
      });
    }

    const workflow = context.workflowRegistry.registerWorkflow({
      id: "", // Will be generated
      name: body.name,
      description: body.description,
      instructions: body.instructions,
      triggers: body.triggers,
      skills: body.skills,
      orchestratorModel: body.orchestratorModel ?? "opus",
      enabled: true,
    });

    // Sync scheduled jobs if workflow has cron triggers
    const hasCronTrigger = workflow.triggers.some((t) => t.source === "cron" && t.schedule);
    if (hasCronTrigger) {
      context.schedulerService.syncJobsFromWorkflows();
    }

    return reply.status(201).send({ workflow });
  });

  // Update workflow
  server.put<{ Params: { id: string } }>(
    "/api/workflows/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const existing = context.workflowRegistry.getWorkflow(request.params.id);
      if (!existing) {
        return reply.status(404).send({ error: "Workflow not found" });
      }

      const body = request.body as {
        name?: string;
        description?: string;
        instructions?: string;
        triggers?: Array<{
          source: string;
          events?: string[];
          schedule?: string;
          filters?: { repository?: string; ref?: string[] };
        }>;
        skills?: string[];
        orchestratorModel?: "opus" | "sonnet";
        enabled?: boolean;
      };

      // Validate that referenced skills exist if updating skills
      if (body.skills) {
        const invalidSkills = body.skills.filter((id) => !context.skillRegistry.getSkill(id));
        if (invalidSkills.length > 0) {
          return reply.status(400).send({
            error: `Skills not found: ${invalidSkills.join(", ")}`,
          });
        }
      }

      const workflow = context.workflowRegistry.updateWorkflow(request.params.id, body);
      if (!workflow) {
        return reply.status(404).send({ error: "Workflow not found" });
      }

      // Sync scheduled jobs if workflow has cron triggers
      const hasCronTrigger = workflow.triggers.some((t) => t.source === "cron" && t.schedule);
      if (hasCronTrigger) {
        context.schedulerService.syncJobsFromWorkflows();
      }

      return reply.send({ workflow });
    }
  );

  // Delete workflow
  server.delete<{ Params: { id: string } }>(
    "/api/workflows/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const deleted = context.workflowRegistry.deleteWorkflow(request.params.id);
      if (!deleted) {
        return reply.status(404).send({ error: "Workflow not found" });
      }
      return reply.send({ success: true });
    }
  );

  // List workflow runs
  server.get<{ Params: { id: string }; Querystring: ListParams }>(
    "/api/workflows/:id/runs",
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: ListParams }>,
      reply: FastifyReply
    ) => {
      const workflow = context.workflowRegistry.getWorkflow(request.params.id);
      if (!workflow) {
        return reply.status(404).send({ error: "Workflow not found" });
      }

      const runs = context.workflowRepo.findRunsByWorkflowId(request.params.id);
      return reply.send({ runs });
    }
  );

  // Get workflow run by ID
  server.get<{ Params: { workflowId: string; runId: string } }>(
    "/api/workflows/:workflowId/runs/:runId",
    async (
      request: FastifyRequest<{ Params: { workflowId: string; runId: string } }>,
      reply: FastifyReply
    ) => {
      const run = context.workflowRepo.findRunById(request.params.runId);
      if (!run || run.workflowId !== request.params.workflowId) {
        return reply.status(404).send({ error: "Workflow run not found" });
      }

      // Get skill run details
      const skillRuns = await Promise.all(
        run.skillRuns.map((runId) => context.runRepo.findById(runId))
      );

      return reply.send({ run, skillRuns: skillRuns.filter(Boolean) });
    }
  );

  // Get checkpoints for a workflow run
  server.get<{ Params: { workflowId: string; runId: string } }>(
    "/api/workflows/:workflowId/runs/:runId/checkpoints",
    async (
      request: FastifyRequest<{ Params: { workflowId: string; runId: string } }>,
      reply: FastifyReply
    ) => {
      const run = context.workflowRepo.findRunById(request.params.runId);
      if (!run || run.workflowId !== request.params.workflowId) {
        return reply.status(404).send({ error: "Workflow run not found" });
      }

      const checkpoints = context.checkpointRepo.findByWorkflowRunId(request.params.runId);
      // Parse JSON data for client consumption
      const parsed = checkpoints.map((cp) => ({
        ...cp,
        data: JSON.parse(cp.data) as unknown,
      }));
      return reply.send({ checkpoints: parsed });
    }
  );

  // Manually trigger a workflow
  server.post<{ Params: { id: string } }>(
    "/api/workflows/:id/trigger",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { payload?: Record<string, unknown> };
      }>,
      reply: FastifyReply
    ) => {
      const workflow = context.workflowRegistry.getWorkflow(request.params.id);
      if (!workflow) {
        return reply.status(404).send({ error: "Workflow not found" });
      }

      const payload = request.body?.payload ?? {};

      // Create a manual trigger event
      const event = await context.eventRepo.create({
        source: "api",
        type: "manual",
        payload: { ...payload, manual: true, workflowId: workflow.id },
        metadata: { triggeredBy: "api" },
      });

      // Execute async — execute() creates its own workflow run internally
      void context.workflowExecutor.execute(workflow, event).catch((err: unknown) => {
        console.error(
          `[API] Workflow trigger failed: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      });

      return reply.status(202).send({
        message: "Workflow triggered",
        workflowId: workflow.id,
        event,
      });
    }
  );

  // ======================
  // Checkpoint Endpoints
  // ======================

  // Get checkpoints for a skill run
  server.get<{ Params: { id: string } }>(
    "/api/runs/:id/checkpoints",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const run = await context.runRepo.findById(request.params.id);
      if (!run) {
        return reply.status(404).send({ error: "Run not found" });
      }

      const checkpoints = context.checkpointRepo.findByRunId(request.params.id);
      const parsed = checkpoints.map((cp) => ({
        ...cp,
        data: JSON.parse(cp.data) as unknown,
      }));
      return reply.send({ checkpoints: parsed });
    }
  );

  // Get checkpoints for a workflow run (by workflow run ID directly)
  server.get<{ Params: { id: string } }>(
    "/api/workflow-runs/:id/checkpoints",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const checkpoints = context.checkpointRepo.findByWorkflowRunId(request.params.id);
      const parsed = checkpoints.map((cp) => ({
        ...cp,
        data: JSON.parse(cp.data) as unknown,
      }));
      return reply.send({ checkpoints: parsed });
    }
  );

  // ======================
  // HITL Endpoints
  // ======================

  // List pending HITL requests
  server.get("/api/hitl-requests", async (_request: FastifyRequest, reply: FastifyReply) => {
    const requests = context.hitlRequestRepo.findPending();
    const parsed = requests.map((r) => ({
      ...r,
      context: r.context ? (JSON.parse(r.context) as unknown) : null,
      options: r.options ? (JSON.parse(r.options) as unknown) : null,
    }));
    return reply.send({ requests: parsed });
  });

  // Get HITL request details
  server.get<{ Params: { id: string } }>(
    "/api/hitl-requests/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const hitlRequest = context.hitlRequestRepo.findById(request.params.id);
      if (!hitlRequest) {
        return reply.status(404).send({ error: "HITL request not found" });
      }

      return reply.send({
        request: {
          ...hitlRequest,
          context: hitlRequest.context ? (JSON.parse(hitlRequest.context) as unknown) : null,
          options: hitlRequest.options ? (JSON.parse(hitlRequest.options) as unknown) : null,
        },
      });
    }
  );

  // Submit human response to HITL request
  server.post<{ Params: { id: string } }>(
    "/api/hitl-requests/:id/respond",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const body = request.body as { response: string };
      if (!body.response) {
        return reply.status(400).send({ error: "response is required" });
      }

      const hitlRequest = context.hitlRequestRepo.respond(request.params.id, body.response);
      if (!hitlRequest) {
        return reply.status(404).send({ error: "HITL request not found or not pending" });
      }

      // Resume workflow execution asynchronously
      void context.workflowExecutor.resumeFromCheckpoint(request.params.id).catch((err) => {
        console.error(
          `[API] Failed to resume workflow from HITL request ${request.params.id}:`,
          err
        );
      });

      return reply.send({
        request: {
          ...hitlRequest,
          context: hitlRequest.context ? (JSON.parse(hitlRequest.context) as unknown) : null,
          options: hitlRequest.options ? (JSON.parse(hitlRequest.options) as unknown) : null,
        },
        message: "Workflow resuming",
      });
    }
  );

  // Cancel HITL request
  server.post<{ Params: { id: string } }>(
    "/api/hitl-requests/:id/cancel",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const hitlRequest = context.hitlRequestRepo.cancel(request.params.id);
      if (!hitlRequest) {
        return reply.status(404).send({ error: "HITL request not found or not pending" });
      }

      // Mark the workflow run as failed
      context.workflowRepo.updateRunStatus(hitlRequest.workflowRunId, "failed", {
        error: "Human-in-the-loop request was cancelled",
      });

      context.notificationService.broadcastMessage({
        type: "run_status",
        workflowRunId: hitlRequest.workflowRunId,
        status: "failed",
      });

      return reply.send({ request: hitlRequest, message: "HITL request cancelled" });
    }
  );
}
