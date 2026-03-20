import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PatternService } from "../services/pattern.service.js";
import { httpError } from "../middleware/error-handler.js";

const analyzeSchema = z.object({
  namespace_id: z.string().uuid(),
  pattern_types: z
    .array(z.enum(["sequence", "bottleneck", "collaboration", "knowledge_cluster"]))
    .optional(),
  min_frequency: z.number().min(1).default(2),
  min_confidence: z.number().min(0).max(1).default(0),
});

const listPatternsQuerySchema = z.object({
  namespace_id: z.string().uuid().optional(),
  pattern_type: z.string().optional(),
  min_confidence: z.coerce.number().min(0).max(1).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

const recommendSchema = z.object({
  namespace_id: z.string().uuid(),
  context: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().min(1).max(20).default(5),
});

export function patternRoutes(patternService: PatternService) {
  return async function (app: FastifyInstance) {
    app.post("/api/v1/patterns/analyze", async (req, reply) => {
      const body = analyzeSchema.parse(req.body);
      const patterns = await patternService.analyze(body);
      reply.code(200).send({
        count: patterns.length,
        patterns,
      });
    });

    app.get("/api/v1/patterns", async (req) => {
      const query = listPatternsQuerySchema.parse(req.query);
      return patternService.listPatterns({
        namespace_id: query.namespace_id,
        pattern_type: query.pattern_type,
        min_confidence: query.min_confidence,
        pagination: { limit: query.limit, offset: query.offset },
      });
    });

    app.get("/api/v1/patterns/:id", async (req) => {
      const { id } = req.params as { id: string };
      const pattern = await patternService.getPatternById(id);
      if (!pattern) throw httpError(404, "Pattern not found");
      return pattern;
    });

    app.post("/api/v1/patterns/recommend", async (req) => {
      const body = recommendSchema.parse(req.body);
      const patterns = await patternService.recommend(body);
      return {
        count: patterns.length,
        patterns,
      };
    });
  };
}
