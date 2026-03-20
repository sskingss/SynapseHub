import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { config } from "./config.js";
import { errorHandler } from "./middleware/error-handler.js";
import { authMiddleware } from "./middleware/auth.js";
import { createEmbeddingProvider } from "./services/embedding.service.js";
import { createStorageProvider } from "./services/storage.service.js";
import { KnowledgeService } from "./services/knowledge.service.js";
import { SearchService } from "./services/search.service.js";
import { GraphService } from "./services/graph.service.js";
import { WorkflowService } from "./services/workflow.service.js";
import { PatternService } from "./services/pattern.service.js";
import { healthRoutes } from "./routes/health.routes.js";
import { namespaceRoutes } from "./routes/namespaces.routes.js";
import { collectionRoutes } from "./routes/collections.routes.js";
import { knowledgeRoutes } from "./routes/knowledge.routes.js";
import { searchRoutes } from "./routes/search.routes.js";
import { fileRoutes } from "./routes/files.routes.js";
import { graphRoutes } from "./routes/graph.routes.js";
import { workflowRoutes } from "./routes/workflow.routes.js";
import { patternRoutes } from "./routes/pattern.routes.js";

async function main() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.LOG_LEVEL === "debug" || config.LOG_LEVEL === "trace"
          ? { target: "pino-pretty" }
          : undefined,
    },
  });

  // ── Plugins ───────────────────────────────────────────
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

  // ── Error handling ────────────────────────────────────
  app.setErrorHandler(errorHandler);

  // Wrap Zod validation errors into 400 responses
  app.addHook("preHandler", async (request, reply) => {
    // Zod errors are caught by the error handler,
    // but we also want to format them nicely
  });

  // ── Services ──────────────────────────────────────────
  const embeddingProvider = createEmbeddingProvider();
  const storageProvider = createStorageProvider();
  const knowledgeService = new KnowledgeService(embeddingProvider);
  const searchService = new SearchService(embeddingProvider);
  const graphService = new GraphService();
  const workflowService = new WorkflowService();
  const patternService = new PatternService();

  app.log.info(`Embedding provider: ${config.EMBEDDING_PROVIDER} (dim=${config.EMBEDDING_DIMENSION})`);

  // ── Public routes (no auth) ───────────────────────────
  await app.register(healthRoutes);

  // ── Protected routes ──────────────────────────────────
  await app.register(async function protectedRoutes(protectedApp) {
    protectedApp.addHook("preHandler", authMiddleware);

    await protectedApp.register(namespaceRoutes(knowledgeService));
    await protectedApp.register(collectionRoutes(knowledgeService));
    await protectedApp.register(knowledgeRoutes(knowledgeService));
    await protectedApp.register(searchRoutes(searchService, graphService));
    await protectedApp.register(fileRoutes(knowledgeService, storageProvider));
    await protectedApp.register(graphRoutes(graphService));
    await protectedApp.register(workflowRoutes(workflowService));
    await protectedApp.register(patternRoutes(patternService));
  });

  // ── Graceful shutdown ─────────────────────────────────
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down...`);
      await app.close();
      process.exit(0);
    });
  }

  // ── Start ─────────────────────────────────────────────
  await app.listen({ port: config.PORT, host: config.HOST });

  console.log(`
  ╔══════════════════════════════════════════════╗
  ║                                              ║
  ║   SynapseHub is running                      ║
  ║                                              ║
  ║   API:  http://${config.HOST}:${config.PORT}            ║
  ║   Docs: http://${config.HOST}:${config.PORT}/health     ║
  ║                                              ║
  ╚══════════════════════════════════════════════╝
  `);
}

main().catch((err) => {
  console.error("Failed to start SynapseHub:", err);
  process.exit(1);
});
