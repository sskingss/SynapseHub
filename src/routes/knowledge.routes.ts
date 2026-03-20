import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { KnowledgeService } from "../services/knowledge.service.js";
import { httpError } from "../middleware/error-handler.js";

const createKnowledgeSchema = z.object({
  namespace_id: z.string().uuid(),
  collection_id: z.string().uuid().optional(),
  title: z.string().max(500).optional(),
  content: z.string().min(1),
  content_type: z.enum(["text", "markdown", "json", "code", "html"]).default("text"),
  structured_data: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).default([]),
  source_agent: z.string().max(255).optional(),
  source_context: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateKnowledgeSchema = z.object({
  title: z.string().max(500).optional(),
  content: z.string().min(1).optional(),
  content_type: z.enum(["text", "markdown", "json", "code", "html"]).optional(),
  structured_data: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const listQuerySchema = z.object({
  namespace_id: z.string().uuid().optional(),
  collection_id: z.string().uuid().optional(),
  source_agent: z.string().optional(),
  content_type: z.string().optional(),
  tags: z.string().optional(), // comma-separated
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

export function knowledgeRoutes(knowledgeService: KnowledgeService) {
  return async function (app: FastifyInstance) {
    app.post("/api/v1/knowledge", async (req, reply) => {
      const body = createKnowledgeSchema.parse(req.body);
      const item = await knowledgeService.create(body);
      reply.code(201).send(item);
    });

    app.get("/api/v1/knowledge/:id", async (req) => {
      const { id } = req.params as { id: string };
      const item = await knowledgeService.getById(id);
      if (!item) throw httpError(404, "Knowledge item not found");
      return item;
    });

    app.put("/api/v1/knowledge/:id", async (req) => {
      const { id } = req.params as { id: string };
      const body = updateKnowledgeSchema.parse(req.body);
      const item = await knowledgeService.update(id, body);
      if (!item) throw httpError(404, "Knowledge item not found");
      return item;
    });

    app.delete("/api/v1/knowledge/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const deleted = await knowledgeService.delete(id);
      if (!deleted) throw httpError(404, "Knowledge item not found");
      reply.code(204).send();
    });

    app.get("/api/v1/knowledge", async (req) => {
      const query = listQuerySchema.parse(req.query);
      const tags = query.tags?.split(",").filter(Boolean);
      return knowledgeService.list({
        namespace_id: query.namespace_id,
        collection_id: query.collection_id,
        source_agent: query.source_agent,
        content_type: query.content_type,
        tags,
        pagination: { limit: query.limit, offset: query.offset },
      });
    });
  };
}
