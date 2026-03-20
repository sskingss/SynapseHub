import { eq, and, or, sql, desc } from "drizzle-orm";
import { db } from "../db/connection.js";
import { knowledgeRelations, knowledgeItems } from "../db/schema.js";
import type {
  CreateRelationInput,
  GraphNeighborsRequest,
  GraphPathRequest,
  GraphPathResponse,
  SubgraphRequest,
  SubgraphResponse,
  GraphNode,
  GraphEdge,
  PaginationParams,
} from "../types/index.js";

export class GraphService {
  async createRelation(input: CreateRelationInput) {
    const [relation] = await db
      .insert(knowledgeRelations)
      .values({
        sourceId: input.source_id,
        targetId: input.target_id,
        relationType: input.relation_type,
        weight: input.weight ?? 1.0,
        metadata: input.metadata ?? {},
        createdBy: input.created_by,
      })
      .returning();

    return relation!;
  }

  async deleteRelation(id: string): Promise<boolean> {
    const result = await db
      .delete(knowledgeRelations)
      .where(eq(knowledgeRelations.id, id))
      .returning({ id: knowledgeRelations.id });

    return result.length > 0;
  }

  async getRelation(id: string) {
    const [relation] = await db
      .select()
      .from(knowledgeRelations)
      .where(eq(knowledgeRelations.id, id))
      .limit(1);

    return relation ?? null;
  }

  async listRelations(filters: {
    source_id?: string;
    target_id?: string;
    relation_type?: string;
    pagination: PaginationParams;
  }) {
    const conditions = [];

    if (filters.source_id) {
      conditions.push(eq(knowledgeRelations.sourceId, filters.source_id));
    }
    if (filters.target_id) {
      conditions.push(eq(knowledgeRelations.targetId, filters.target_id));
    }
    if (filters.relation_type) {
      conditions.push(eq(knowledgeRelations.relationType, filters.relation_type));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(knowledgeRelations)
        .where(whereClause)
        .orderBy(desc(knowledgeRelations.createdAt))
        .limit(filters.pagination.limit)
        .offset(filters.pagination.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(knowledgeRelations)
        .where(whereClause),
    ]);

    return {
      data,
      total: countResult[0]?.count ?? 0,
      limit: filters.pagination.limit,
      offset: filters.pagination.offset,
    };
  }

  async getNeighbors(req: GraphNeighborsRequest): Promise<{
    nodes: GraphNode[];
    edges: GraphEdge[];
  }> {
    const depth = req.depth ?? 1;
    const limit = req.limit ?? 50;
    const direction = req.direction ?? "both";

    const typeFilter = req.relation_type
      ? sql`AND kr.relation_type = ${req.relation_type}`
      : sql``;

    const directionFilter =
      direction === "outgoing"
        ? sql`kr.source_id = ANY(current_ids)`
        : direction === "incoming"
          ? sql`kr.target_id = ANY(current_ids)`
          : sql`(kr.source_id = ANY(current_ids) OR kr.target_id = ANY(current_ids))`;

    const result = await db.execute<{
      node_id: string;
      title: string | null;
      content_type: string;
      tags: string[];
      source_agent: string | null;
      metadata: Record<string, unknown>;
      edge_id: string;
      source_id: string;
      target_id: string;
      relation_type: string;
      weight: number | null;
      edge_metadata: Record<string, unknown>;
    }>(sql`
      WITH RECURSIVE traversal AS (
        SELECT ARRAY[${req.node_id}::uuid] AS current_ids, 0 AS depth
        UNION ALL
        SELECT
          array_agg(DISTINCT neighbor_id) AS current_ids,
          t.depth + 1
        FROM traversal t,
        LATERAL (
          SELECT CASE
            WHEN kr.source_id = ANY(t.current_ids) THEN kr.target_id
            ELSE kr.source_id
          END AS neighbor_id
          FROM knowledge_relations kr
          WHERE ${directionFilter} ${typeFilter}
            AND CASE
              WHEN kr.source_id = ANY(t.current_ids) THEN kr.target_id
              ELSE kr.source_id
            END != ${req.node_id}::uuid
        ) sub
        WHERE t.depth < ${depth}
        GROUP BY t.depth
      ),
      all_neighbor_ids AS (
        SELECT DISTINCT unnest(current_ids) AS nid
        FROM traversal
        WHERE depth > 0
        LIMIT ${limit}
      )
      SELECT
        ki.id AS node_id,
        ki.title,
        ki.content_type,
        ki.tags,
        ki.source_agent,
        ki.metadata,
        kr.id AS edge_id,
        kr.source_id,
        kr.target_id,
        kr.relation_type,
        kr.weight,
        kr.metadata AS edge_metadata
      FROM all_neighbor_ids ani
      JOIN knowledge_items ki ON ki.id = ani.nid
      JOIN knowledge_relations kr ON (
        (kr.source_id = ani.nid OR kr.target_id = ani.nid)
        AND (kr.source_id = ${req.node_id}::uuid OR kr.target_id = ${req.node_id}::uuid
             OR kr.source_id IN (SELECT nid FROM all_neighbor_ids)
             AND kr.target_id IN (SELECT nid FROM all_neighbor_ids))
      )
    `);

    const nodesMap = new Map<string, GraphNode>();
    const edgesMap = new Map<string, GraphEdge>();

    for (const row of result.rows) {
      if (!nodesMap.has(row.node_id)) {
        nodesMap.set(row.node_id, {
          id: row.node_id,
          title: row.title,
          content_type: row.content_type,
          tags: row.tags ?? [],
          source_agent: row.source_agent,
          metadata: (row.metadata as Record<string, unknown>) ?? {},
        });
      }
      if (!edgesMap.has(row.edge_id)) {
        edgesMap.set(row.edge_id, {
          id: row.edge_id,
          source_id: row.source_id,
          target_id: row.target_id,
          relation_type: row.relation_type,
          weight: row.weight,
          metadata: (row.edge_metadata as Record<string, unknown>) ?? {},
        });
      }
    }

    return {
      nodes: Array.from(nodesMap.values()),
      edges: Array.from(edgesMap.values()),
    };
  }

  async findPath(req: GraphPathRequest): Promise<GraphPathResponse | null> {
    const maxDepth = req.max_depth ?? 5;

    const typeFilter =
      req.relation_types && req.relation_types.length > 0
        ? sql`AND kr.relation_type = ANY(${req.relation_types}::text[])`
        : sql``;

    const result = await db.execute<{
      path: string[];
      depth: number;
    }>(sql`
      WITH RECURSIVE paths AS (
        SELECT
          kr.source_id,
          kr.target_id,
          ARRAY[kr.source_id, kr.target_id] AS path,
          1 AS depth
        FROM knowledge_relations kr
        WHERE kr.source_id = ${req.source_id}::uuid ${typeFilter}
        UNION ALL
        SELECT
          p.source_id,
          kr.target_id,
          p.path || kr.target_id,
          p.depth + 1
        FROM paths p
        JOIN knowledge_relations kr ON kr.source_id = p.target_id
        WHERE kr.target_id != ALL(p.path)
          AND p.depth < ${maxDepth}
          ${typeFilter}
      )
      SELECT path, depth FROM paths
      WHERE target_id = ${req.target_id}::uuid
      ORDER BY depth
      LIMIT 1
    `);

    if (result.rows.length === 0) return null;

    const row = result.rows[0]!;
    const pathIds: string[] = row.path;

    const edges: GraphEdge[] = [];
    for (let i = 0; i < pathIds.length - 1; i++) {
      const [edge] = await db
        .select()
        .from(knowledgeRelations)
        .where(
          and(
            eq(knowledgeRelations.sourceId, pathIds[i]!),
            eq(knowledgeRelations.targetId, pathIds[i + 1]!),
          ),
        )
        .limit(1);
      if (edge) {
        edges.push({
          id: edge.id,
          source_id: edge.sourceId,
          target_id: edge.targetId,
          relation_type: edge.relationType,
          weight: edge.weight,
          metadata: (edge.metadata as Record<string, unknown>) ?? {},
        });
      }
    }

    return {
      path: pathIds,
      edges,
      depth: row.depth,
    };
  }

  async getSubgraph(req: SubgraphRequest): Promise<SubgraphResponse> {
    const depth = req.depth ?? 2;
    const limit = req.limit ?? 100;

    const typeFilter =
      req.relation_types && req.relation_types.length > 0
        ? sql`AND kr.relation_type = ANY(${req.relation_types}::text[])`
        : sql``;

    const result = await db.execute<{
      node_id: string;
      title: string | null;
      content_type: string;
      tags: string[];
      source_agent: string | null;
      node_metadata: Record<string, unknown>;
      edge_id: string | null;
      source_id: string | null;
      target_id: string | null;
      relation_type: string | null;
      weight: number | null;
      edge_metadata: Record<string, unknown> | null;
    }>(sql`
      WITH RECURSIVE reachable AS (
        SELECT ${req.node_id}::uuid AS nid, 0 AS depth
        UNION
        SELECT
          CASE WHEN kr.source_id = r.nid THEN kr.target_id ELSE kr.source_id END,
          r.depth + 1
        FROM reachable r
        JOIN knowledge_relations kr
          ON (kr.source_id = r.nid OR kr.target_id = r.nid) ${typeFilter}
        WHERE r.depth < ${depth}
      ),
      distinct_nodes AS (
        SELECT DISTINCT nid FROM reachable LIMIT ${limit}
      )
      SELECT
        ki.id AS node_id,
        ki.title,
        ki.content_type,
        ki.tags,
        ki.source_agent,
        ki.metadata AS node_metadata,
        kr.id AS edge_id,
        kr.source_id,
        kr.target_id,
        kr.relation_type,
        kr.weight,
        kr.metadata AS edge_metadata
      FROM distinct_nodes dn
      JOIN knowledge_items ki ON ki.id = dn.nid
      LEFT JOIN knowledge_relations kr ON (
        kr.source_id IN (SELECT nid FROM distinct_nodes)
        AND kr.target_id IN (SELECT nid FROM distinct_nodes)
      )
    `);

    const nodesMap = new Map<string, GraphNode>();
    const edgesMap = new Map<string, GraphEdge>();

    for (const row of result.rows) {
      if (!nodesMap.has(row.node_id)) {
        nodesMap.set(row.node_id, {
          id: row.node_id,
          title: row.title,
          content_type: row.content_type,
          tags: row.tags ?? [],
          source_agent: row.source_agent,
          metadata: (row.node_metadata as Record<string, unknown>) ?? {},
        });
      }
      if (row.edge_id && !edgesMap.has(row.edge_id)) {
        edgesMap.set(row.edge_id, {
          id: row.edge_id,
          source_id: row.source_id!,
          target_id: row.target_id!,
          relation_type: row.relation_type!,
          weight: row.weight,
          metadata: (row.edge_metadata as Record<string, unknown>) ?? {},
        });
      }
    }

    return {
      center_node_id: req.node_id,
      nodes: Array.from(nodesMap.values()),
      edges: Array.from(edgesMap.values()),
    };
  }

  /**
   * Topological sort of a subgraph rooted at the given nodes.
   * Useful for deriving execution order from knowledge relations.
   */
  async topologicalSort(nodeIds: string[]): Promise<string[]> {
    if (nodeIds.length === 0) return [];

    const edges = await db
      .select()
      .from(knowledgeRelations)
      .where(
        and(
          sql`${knowledgeRelations.sourceId} = ANY(${nodeIds}::uuid[])`,
          sql`${knowledgeRelations.targetId} = ANY(${nodeIds}::uuid[])`,
        ),
      );

    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const id of nodeIds) {
      inDegree.set(id, 0);
      adjacency.set(id, []);
    }

    for (const edge of edges) {
      adjacency.get(edge.sourceId)?.push(edge.targetId);
      inDegree.set(edge.targetId, (inDegree.get(edge.targetId) ?? 0) + 1);
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const node = queue.shift()!;
      sorted.push(node);
      for (const neighbor of adjacency.get(node) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }

    return sorted;
  }
}
