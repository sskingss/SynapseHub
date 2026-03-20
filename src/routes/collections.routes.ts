import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { KnowledgeService } from "../services/knowledge.service.js";
import { httpError } from "../middleware/error-handler.js";

const createCollectionSchema = z.object({
  namespace_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export function collectionRoutes(knowledgeService: KnowledgeService) {
  return async function (app: FastifyInstance) {
    app.post("/api/v1/collections", async (req, reply) => {
      const body = createCollectionSchema.parse(req.body);
      const coll = await knowledgeService.createCollection(
        body.namespace_id,
        body.name,
        body.description,
        body.metadata,
      );
      reply.code(201).send(coll);
    });

    app.get("/api/v1/collections", async (req) => {
      const { namespace_id } = req.query as { namespace_id?: string };
      return knowledgeService.listCollections(namespace_id);
    });

    app.get("/api/v1/collections/:id", async (req) => {
      const { id } = req.params as { id: string };
      const coll = await knowledgeService.getCollectionById(id);
      if (!coll) throw httpError(404, "Collection not found");
      return coll;
    });
  };
}
