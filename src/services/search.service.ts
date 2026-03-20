import { sql, SQL } from "drizzle-orm";
import { eq, and } from "drizzle-orm";
import { db } from "../db/connection.js";
import { knowledgeItems, knowledgeRelations } from "../db/schema.js";
import type { GraphService } from "./graph.service.js";
import type {
  EmbeddingProvider,
  SearchRequest,
  SearchResult,
  GraphSearchRequest,
  GraphSearchResult,
} from "../types/index.js";

export class SearchService {
  private graphService: GraphService | null = null;

  constructor(private embeddingProvider: EmbeddingProvider) {}

  setGraphService(graphService: GraphService) {
    this.graphService = graphService;
  }

  /**
   * Hybrid search combining semantic similarity and full-text search
   * using Reciprocal Rank Fusion (RRF) for score merging.
   */
  async search(req: SearchRequest): Promise<SearchResult[]> {
    const limit = req.limit ?? 10;
    const minScore = req.min_score ?? 0;
    const mode = req.mode ?? "hybrid";

    if (mode === "semantic") {
      return this.semanticSearch(req, limit, minScore);
    }
    if (mode === "fulltext") {
      return this.fulltextSearch(req, limit, minScore);
    }

    // Hybrid: run both and merge with RRF
    const [semanticResults, fulltextResults] = await Promise.all([
      this.semanticSearch(req, limit * 2, 0),
      this.fulltextSearch(req, limit * 2, 0),
    ]);

    return this.reciprocalRankFusion(semanticResults, fulltextResults, limit, minScore);
  }

  private async semanticSearch(
    req: SearchRequest,
    limit: number,
    minScore: number,
  ): Promise<SearchResult[]> {
    const queryEmbedding = await this.embeddingProvider.embed(req.query);
    const vectorStr = `[${queryEmbedding.join(",")}]`;

    const conditions = this.buildFilterConditions(req);

    const query = conditions
      ? sql`
          SELECT
            id, title, content, content_type, tags, source_agent,
            metadata, created_at,
            1 - (embedding <=> ${vectorStr}::vector) AS score
          FROM knowledge_items
          WHERE embedding IS NOT NULL AND ${conditions}
          ORDER BY embedding <=> ${vectorStr}::vector
          LIMIT ${limit}
        `
      : sql`
          SELECT
            id, title, content, content_type, tags, source_agent,
            metadata, created_at,
            1 - (embedding <=> ${vectorStr}::vector) AS score
          FROM knowledge_items
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> ${vectorStr}::vector
          LIMIT ${limit}
        `;

    const results = await db.execute<{
      id: string;
      title: string | null;
      content: string;
      content_type: string;
      tags: string[];
      source_agent: string | null;
      metadata: Record<string, unknown>;
      created_at: Date;
      score: number;
    }>(query);

    return results.rows
      .filter((r) => r.score >= minScore)
      .map((r) => ({
        id: r.id,
        title: r.title,
        content: r.content,
        content_type: r.content_type,
        tags: r.tags ?? [],
        source_agent: r.source_agent,
        metadata: (r.metadata as Record<string, unknown>) ?? {},
        score: Math.round(r.score * 10000) / 10000,
        match_type: "semantic" as const,
        created_at: r.created_at,
      }));
  }

  private async fulltextSearch(
    req: SearchRequest,
    limit: number,
    minScore: number,
  ): Promise<SearchResult[]> {
    const conditions = this.buildFilterConditions(req);

    // Convert the natural language query to a tsquery-compatible format
    const tsQuery = req.query
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/[^\w]/g, ""))
      .filter(Boolean)
      .join(" | ");

    if (!tsQuery) return [];

    const query = conditions
      ? sql`
          SELECT
            id, title, content, content_type, tags, source_agent,
            metadata, created_at,
            ts_rank(
              to_tsvector('english', coalesce(title, '') || ' ' || content),
              to_tsquery('english', ${tsQuery})
            ) AS score
          FROM knowledge_items
          WHERE to_tsvector('english', coalesce(title, '') || ' ' || content)
                @@ to_tsquery('english', ${tsQuery})
            AND ${conditions}
          ORDER BY score DESC
          LIMIT ${limit}
        `
      : sql`
          SELECT
            id, title, content, content_type, tags, source_agent,
            metadata, created_at,
            ts_rank(
              to_tsvector('english', coalesce(title, '') || ' ' || content),
              to_tsquery('english', ${tsQuery})
            ) AS score
          FROM knowledge_items
          WHERE to_tsvector('english', coalesce(title, '') || ' ' || content)
                @@ to_tsquery('english', ${tsQuery})
          ORDER BY score DESC
          LIMIT ${limit}
        `;

    const results = await db.execute<{
      id: string;
      title: string | null;
      content: string;
      content_type: string;
      tags: string[];
      source_agent: string | null;
      metadata: Record<string, unknown>;
      created_at: Date;
      score: number;
    }>(query);

    const maxScore = Math.max(...results.rows.map((r) => r.score), 1);

    return results.rows
      .map((r) => ({
        id: r.id,
        title: r.title,
        content: r.content,
        content_type: r.content_type,
        tags: r.tags ?? [],
        source_agent: r.source_agent,
        metadata: (r.metadata as Record<string, unknown>) ?? {},
        score: Math.round((r.score / maxScore) * 10000) / 10000,
        match_type: "fulltext" as const,
        created_at: r.created_at,
      }))
      .filter((r) => r.score >= minScore);
  }

  /**
   * Reciprocal Rank Fusion merges two ranked lists.
   * RRF(d) = sum(1 / (k + rank_i(d))) for each ranker i.
   */
  private reciprocalRankFusion(
    listA: SearchResult[],
    listB: SearchResult[],
    limit: number,
    minScore: number,
  ): SearchResult[] {
    const K = 60; // standard RRF constant
    const scores = new Map<string, { score: number; item: SearchResult }>();

    listA.forEach((item, rank) => {
      const rrfScore = 1 / (K + rank + 1);
      const existing = scores.get(item.id);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scores.set(item.id, { score: rrfScore, item: { ...item, match_type: "hybrid" } });
      }
    });

    listB.forEach((item, rank) => {
      const rrfScore = 1 / (K + rank + 1);
      const existing = scores.get(item.id);
      if (existing) {
        existing.score += rrfScore;
        existing.item.match_type = "hybrid";
      } else {
        scores.set(item.id, { score: rrfScore, item: { ...item, match_type: "hybrid" } });
      }
    });

    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .filter((r) => r.score >= minScore)
      .slice(0, limit)
      .map((r) => ({
        ...r.item,
        score: Math.round(r.score * 10000) / 10000,
      }));
  }

  /**
   * Graph-aware search: performs a standard search then enriches results
   * with related nodes from the knowledge graph.
   */
  async graphSearch(req: GraphSearchRequest): Promise<GraphSearchResult[]> {
    if (!this.graphService) {
      throw new Error("GraphService not configured");
    }

    const baseResults = await this.search(req);
    const relationDepth = req.relation_depth ?? 1;

    const enriched: GraphSearchResult[] = [];

    for (const result of baseResults) {
      const neighbors = await this.graphService.getNeighbors({
        node_id: result.id,
        direction: "both",
        depth: relationDepth,
        limit: 5,
      });

      enriched.push({
        ...result,
        related_items: neighbors.nodes.map((node) => {
          const edge = neighbors.edges.find(
            (e) => e.source_id === node.id || e.target_id === node.id,
          );
          return {
            item: node,
            relation: edge!,
          };
        }).filter((ri) => ri.relation !== undefined),
      });
    }

    return enriched;
  }

  private buildFilterConditions(req: SearchRequest): SQL | undefined {
    const conditions: SQL[] = [];

    if (req.namespace) {
      conditions.push(eq(knowledgeItems.namespaceId, req.namespace));
    }
    if (req.collection_id) {
      conditions.push(eq(knowledgeItems.collectionId, req.collection_id));
    }
    if (req.tags && req.tags.length > 0) {
      conditions.push(sql`${knowledgeItems.tags} && ${req.tags}::text[]`);
    }
    if (req.content_type) {
      conditions.push(eq(knowledgeItems.contentType, req.content_type));
    }

    return conditions.length > 0 ? and(...conditions) : undefined;
  }
}
