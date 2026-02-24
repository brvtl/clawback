import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ServerContext } from "../server.js";

interface ChatRequest {
  sessionId?: string;
  message: string;
}

export function registerBuilderRoutes(server: FastifyInstance, context: ServerContext): void {
  // POST /api/builder/chat — start a new turn (returns 202 immediately)
  server.post<{ Body: ChatRequest }>(
    "/api/builder/chat",
    async (request: FastifyRequest<{ Body: ChatRequest }>, reply: FastifyReply) => {
      const { sessionId: existingSessionId, message } = request.body;

      if (!message?.trim()) {
        return reply.status(400).send({ error: "message is required" });
      }

      let sessionId: string;

      // Create new session if none provided
      if (!existingSessionId) {
        const session = context.builderSessionRepo.create();
        sessionId = session.id;
      } else {
        sessionId = existingSessionId;

        // Verify session exists
        const session = context.builderSessionRepo.findById(sessionId);
        if (!session) {
          return reply.status(404).send({ error: "Session not found" });
        }

        // Check if already processing
        if (context.builderExecutor.isProcessing(sessionId)) {
          return reply.status(409).send({ error: "Session is already processing" });
        }
      }

      // Fire off the async turn
      try {
        context.builderExecutor.startTurn(sessionId, message.trim());
      } catch (error) {
        return reply.status(409).send({
          error: error instanceof Error ? error.message : "Failed to start turn",
        });
      }

      return reply.status(202).send({ sessionId });
    }
  );

  // GET /api/builder/sessions — list sessions
  server.get("/api/builder/sessions", async (_request: FastifyRequest, reply: FastifyReply) => {
    const sessions = context.builderSessionRepo.findAll();
    return reply.send({
      sessions: sessions.map((s) => ({
        id: s.id,
        status: s.status,
        title: s.title,
        lastError: s.lastError,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    });
  });

  // GET /api/builder/sessions/:id — get session with messages
  server.get<{ Params: { id: string } }>(
    "/api/builder/sessions/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const session = context.builderSessionRepo.findById(request.params.id);
      if (!session) {
        return reply.status(404).send({ error: "Session not found" });
      }

      return reply.send({
        session: {
          id: session.id,
          status: session.status,
          title: session.title,
          lastError: session.lastError,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        },
        messages: JSON.parse(session.messages) as unknown[],
      });
    }
  );
}
