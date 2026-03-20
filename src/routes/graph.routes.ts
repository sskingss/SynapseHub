import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { GraphService } from "../services/graph.service.js";
import { httpError } from "../middleware/error-handler.js";

const createRelationSchema = z.object({
  source_id: z.string().uuid(),
  target_id: z.string().uuid(),
  relation_type: z.string().min(1).max(100),
  weight: z.number().min(0).max(100).default(1.0),
  metadata: z.record(z.unknown()).optional(),
  created_by: z.string().max(255).optional(),
});

const listRelationsQuerySchema = z.object({
  source_id: z.string().uuid().optional(),
  target_id: z.string().uuid().optional(),
  relation_type: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

const neighborsQuerySchema = z.object({
  direction: z.enum(["outgoing", "incoming", "both"]).default("both"),
  relation_type: z.string().optional(),
  depth: z.coerce.number().min(1).max(5).default(1),
  limit: z.coerce.number().min(1).max(200).default(50),
});

const pathSchema = z.object({
  source_id: z.string().uuid(),
  target_id: z.string().uuid(),
  max_depth: z.number().min(1).max(10).default(5),
  relation_types: z.array(z.string()).optional(),
});

const subgraphSchema = z.object({
  node_id: z.string().uuid(),
  depth: z.number().min(1).max(5).default(2),
  relation_types: z.array(z.string()).optional(),
  limit: z.number().min(1).max(500).default(100),
});

export function graphRoutes(graphService: GraphService) {
  return async function (app: FastifyInstance) {
    app.post("/api/v1/graph/relations", async (req, reply) => {
      const body = createRelationSchema.parse(req.body);
      const relation = await graphService.createRelation(body);
      reply.code(201).send(relation);
    });

    app.get("/api/v1/graph/relations", async (req) => {
      const query = listRelationsQuerySchema.parse(req.query);
      return graphService.listRelations({
        source_id: query.source_id,
        target_id: query.target_id,
        relation_type: query.relation_type,
        pagination: { limit: query.limit, offset: query.offset },
      });
    });

    app.delete("/api/v1/graph/relations/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const deleted = await graphService.deleteRelation(id);
      if (!deleted) throw httpError(404, "Relation not found");
      reply.code(204).send();
    });

    app.get("/api/v1/graph/neighbors/:nodeId", async (req) => {
      const { nodeId } = req.params as { nodeId: string };
      const query = neighborsQuerySchema.parse(req.query);
      return graphService.getNeighbors({
        node_id: nodeId,
        direction: query.direction,
        relation_type: query.relation_type,
        depth: query.depth,
        limit: query.limit,
      });
    });

    app.post("/api/v1/graph/path", async (req) => {
      const body = pathSchema.parse(req.body);
      const result = await graphService.findPath(body);
      if (!result) throw httpError(404, "No path found between the given nodes");
      return result;
    });

    app.post("/api/v1/graph/subgraph", async (req) => {
      const body = subgraphSchema.parse(req.body);
      return graphService.getSubgraph(body);
    });
  };
}
