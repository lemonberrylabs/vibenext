import Fastify from "fastify";
import type { FastifyRequest, FastifyReply } from "fastify";
import {
  createThread,
  getThread,
  getAllThreads,
  sendMessage,
  mergeThread,
  switchToThread,
  pushThread,
} from "./threads";
import type {
  ChatRequest,
  CreateThreadResponse,
  ChatResponse,
  ThreadStateResponse,
  MergeResponse,
  ErrorResponse,
} from "./types";

const PORT = parseInt(process.env.VIBE_PORT || "3001", 10);
const HOST = "127.0.0.1"; // Security: Only bind to localhost

// Working directory is the user's project root
const WORKING_DIR = process.cwd();

async function main() {
  console.log(`[VibeCoder Control Plane] Starting...`);
  console.log(`[VibeCoder Control Plane] Working directory: ${WORKING_DIR}`);

  const fastify = Fastify({
    logger: {
      level: "info",
      transport: {
        target: "pino-pretty",
        options: {
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
    },
  });

  // Security middleware: Reject non-local requests
  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const remoteAddress = request.socket.remoteAddress;
    if (remoteAddress !== "127.0.0.1" && remoteAddress !== "::1" && remoteAddress !== "::ffff:127.0.0.1") {
      console.warn(`[Security] Rejected request from non-local address: ${remoteAddress}`);
      reply.code(403).send({ error: "Forbidden: Only local requests allowed" });
      return;
    }
  });

  // Health check endpoint
  fastify.get("/health", async () => {
    return { status: "ok", workingDir: WORKING_DIR };
  });

  // List all threads
  fastify.get("/threads", async (): Promise<ThreadStateResponse[]> => {
    const threads = getAllThreads();
    return threads.map((t) => ({
      id: t.id,
      branchName: t.branchName,
      createdAt: t.createdAt,
      status: t.status,
      history: t.history,
      lastCommitHash: t.lastCommitHash,
      errorMessage: t.errorMessage,
    }));
  });

  // Create a new thread
  fastify.post("/threads", async (): Promise<CreateThreadResponse | ErrorResponse> => {
    try {
      const thread = await createThread(WORKING_DIR);
      return {
        threadId: thread.id,
        branchName: thread.branchName,
        status: thread.status,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[Server] Failed to create thread:", message);
      return { error: message };
    }
  });

  // Get thread state
  fastify.get<{ Params: { id: string } }>(
    "/threads/:id",
    async (request, reply): Promise<ThreadStateResponse | ErrorResponse> => {
      const { id } = request.params;
      const thread = getThread(id);

      if (!thread) {
        reply.code(404);
        return { error: `Thread ${id} not found` };
      }

      return {
        id: thread.id,
        branchName: thread.branchName,
        createdAt: thread.createdAt,
        status: thread.status,
        history: thread.history,
        lastCommitHash: thread.lastCommitHash,
        errorMessage: thread.errorMessage,
      };
    }
  );

  // Send chat message to thread
  // NOTE: This endpoint returns IMMEDIATELY. The actual processing
  // happens in the background. Client should poll GET /threads/:id for updates.
  fastify.post<{ Params: { id: string }; Body: ChatRequest }>(
    "/threads/:id/chat",
    (request, reply): ChatResponse | ErrorResponse => {
      const { id } = request.params;
      const { message } = request.body;

      if (!message || typeof message !== "string") {
        reply.code(400);
        return { error: "Message is required" };
      }

      try {
        // sendMessage returns synchronously - all async work happens in background
        const status = sendMessage(id, message, WORKING_DIR);
        return { status };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        reply.code(400);
        return { error: errorMessage };
      }
    }
  );

  // Merge thread to main
  fastify.post<{ Params: { id: string } }>(
    "/threads/:id/merge",
    async (request, reply): Promise<MergeResponse> => {
      const { id } = request.params;
      const result = await mergeThread(id, WORKING_DIR);

      if (!result.success) {
        reply.code(400);
      }

      return result;
    }
  );

  // Switch to a thread (checkout its branch)
  fastify.post<{ Params: { id: string } }>(
    "/threads/:id/switch",
    async (request, reply): Promise<ThreadStateResponse | ErrorResponse> => {
      const { id } = request.params;
      
      try {
        const thread = await switchToThread(id, WORKING_DIR);
        return {
          id: thread.id,
          branchName: thread.branchName,
          createdAt: thread.createdAt,
          status: thread.status,
          history: thread.history,
          lastCommitHash: thread.lastCommitHash,
          errorMessage: thread.errorMessage,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        reply.code(400);
        return { error: message };
      }
    }
  );

  // Push thread branch to remote
  fastify.post<{ Params: { id: string } }>(
    "/threads/:id/push",
    async (request, reply): Promise<MergeResponse> => {
      const { id } = request.params;
      const result = await pushThread(id, WORKING_DIR);

      if (!result.success) {
        reply.code(400);
      }

      return result;
    }
  );

  // Start the server
  try {
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`[VibeCoder Control Plane] Listening on http://${HOST}:${PORT}`);
    console.log(`[VibeCoder Control Plane] Ready to accept connections`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.error(`\n[VibeCoder Control Plane] ERROR: Port ${PORT} is already in use.`);
      console.error(`[VibeCoder Control Plane] Vibe Coder requires port ${PORT} to be available.`);
      console.error(`[VibeCoder Control Plane] Please free up the port and try again.\n`);
      process.exit(1);
    }
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
