import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { KnowledgeService } from "../services/knowledge.service.js";
import { httpError } from "../middleware/error-handler.js";

const createNamespaceSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

export function namespaceRoutes(knowledgeService: KnowledgeService) {
  return async function (app: FastifyInstance) {
    app.post("/api/v1/namespaces", async (req, reply) => {
      const body = createNamespaceSchema.parse(req.body);

      const existing = await knowledgeService.getNamespaceByName(body.name);
      if (existing) {
        throw httpError(409, `Namespace "${body.name}" already exists`);
      }

      const ns = await knowledgeService.createNamespace(body.name, body.description);
      reply.code(201).send(ns);
    });

    app.get("/api/v1/namespaces", async () => {
      return knowledgeService.listNamespaces();
    });
  };
}
