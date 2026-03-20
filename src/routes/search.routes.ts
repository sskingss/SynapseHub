import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SearchService } from "../services/search.service.js";

const searchSchema = z.object({
  query: z.string().min(1),
  namespace: z.string().uuid().optional(),
  collection_id: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
  content_type: z.string().optional(),
  limit: z.number().min(1).max(100).default(10),
  min_score: z.number().min(0).max(1).default(0),
  mode: z.enum(["hybrid", "semantic", "fulltext"]).default("hybrid"),
});

export function searchRoutes(searchService: SearchService) {
  return async function (app: FastifyInstance) {
    app.post("/api/v1/search", async (req) => {
      const body = searchSchema.parse(req.body);
      const results = await searchService.search(body);
      return {
        query: body.query,
        mode: body.mode,
        count: results.length,
        results,
      };
    });

    app.post("/api/v1/search/semantic", async (req) => {
      const body = searchSchema.parse({ ...req.body as object, mode: "semantic" });
      const results = await searchService.search(body);
      return {
        query: body.query,
        mode: "semantic",
        count: results.length,
        results,
      };
    });

    app.post("/api/v1/search/structured", async (req) => {
      const body = searchSchema.parse({ ...req.body as object, mode: "fulltext" });
      const results = await searchService.search(body);
      return {
        query: body.query,
        mode: "fulltext",
        count: results.length,
        results,
      };
    });
  };
}
