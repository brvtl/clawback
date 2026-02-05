import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ServerContext } from "../server.js";

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
    });

    return reply.status(201).send({ skill });
  });

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
      });

      if (!skill) {
        return reply.status(404).send({ error: "Skill not found" });
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
      args?: string[];
      env?: Record<string, string>;
    };

    // Check for duplicate name
    const existing = context.mcpServerRepo.findByName(body.name);
    if (existing) {
      return reply
        .status(400)
        .send({ error: `MCP server with name "${body.name}" already exists` });
    }

    const server = context.mcpServerRepo.create({
      name: body.name,
      description: body.description,
      command: body.command,
      args: body.args,
      env: body.env,
    });

    return reply.status(201).send({ server });
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
        args?: string[];
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

      const updated = context.mcpServerRepo.update(request.params.id, body);
      return reply.send({ server: updated });
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
}
