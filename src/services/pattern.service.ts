import { eq, and, sql, desc, gte } from "drizzle-orm";
import { db } from "../db/connection.js";
import { workPatterns, knowledgeRelations, knowledgeItems } from "../db/schema.js";
import type {
  AnalyzePatternsInput,
  PatternRecommendRequest,
  PatternDetail,
  PatternType,
  PaginationParams,
} from "../types/index.js";

export class PatternService {
  async analyze(input: AnalyzePatternsInput): Promise<PatternDetail[]> {
    const types = input.pattern_types ?? ["sequence", "bottleneck", "collaboration", "knowledge_cluster"];
    const discovered: PatternDetail[] = [];

    for (const type of types) {
      switch (type) {
        case "sequence":
          discovered.push(...await this.analyzeSequences(input));
          break;
        case "bottleneck":
          discovered.push(...await this.analyzeBottlenecks(input));
          break;
        case "collaboration":
          discovered.push(...await this.analyzeCollaboration(input));
          break;
        case "knowledge_cluster":
          discovered.push(...await this.analyzeKnowledgeClusters(input));
          break;
      }
    }

    return discovered;
  }

  private async analyzeSequences(input: AnalyzePatternsInput): Promise<PatternDetail[]> {
    const minFreq = input.min_frequency ?? 2;

    const result = await db.execute<{
      sequence: string[];
      frequency: number;
      execution_ids: string[];
    }>(sql`
      WITH step_sequences AS (
        SELECT
          we.id AS execution_id,
          we.template_id,
          array_agg(ws.step_key ORDER BY wse.started_at) AS sequence
        FROM workflow_step_executions wse
        JOIN workflow_executions we ON we.id = wse.execution_id
        JOIN workflow_steps ws ON ws.id = wse.step_id
        WHERE wse.status = 'completed'
          AND we.namespace_id = ${input.namespace_id}::uuid
        GROUP BY we.id, we.template_id
      )
      SELECT
        sequence,
        COUNT(*)::int AS frequency,
        array_agg(execution_id) AS execution_ids
      FROM step_sequences
      GROUP BY sequence
      HAVING COUNT(*) >= ${minFreq}
      ORDER BY frequency DESC
      LIMIT 20
    `);

    const patterns: PatternDetail[] = [];
    for (const row of result.rows) {
      const [pattern] = await db
        .insert(workPatterns)
        .values({
          namespaceId: input.namespace_id,
          name: `Sequence: ${row.sequence.join(" -> ")}`,
          description: `Frequently occurring step sequence observed ${row.frequency} times`,
          patternType: "sequence",
          frequency: row.frequency,
          confidence: Math.min(row.frequency / 10, 1.0),
          patternData: { sequence: row.sequence, execution_count: row.frequency },
          sourceExecutionIds: row.execution_ids,
        })
        .onConflictDoNothing()
        .returning();

      if (pattern) {
        patterns.push(this.toPatternDetail(pattern));
      }
    }

    return patterns;
  }

  private async analyzeBottlenecks(input: AnalyzePatternsInput): Promise<PatternDetail[]> {
    const result = await db.execute<{
      step_id: string;
      step_key: string;
      step_name: string;
      avg_duration_seconds: number;
      failure_rate: number;
      execution_count: number;
    }>(sql`
      SELECT
        ws.id AS step_id,
        ws.step_key,
        ws.name AS step_name,
        AVG(EXTRACT(EPOCH FROM (wse.completed_at - wse.started_at)))::real AS avg_duration_seconds,
        (COUNT(*) FILTER (WHERE wse.status = 'failed')::real / NULLIF(COUNT(*)::real, 0)) AS failure_rate,
        COUNT(*)::int AS execution_count
      FROM workflow_step_executions wse
      JOIN workflow_steps ws ON ws.id = wse.step_id
      JOIN workflow_executions we ON we.id = wse.execution_id
      WHERE we.namespace_id = ${input.namespace_id}::uuid
        AND wse.completed_at IS NOT NULL
        AND wse.started_at IS NOT NULL
      GROUP BY ws.id, ws.step_key, ws.name
      HAVING COUNT(*) >= 2
      ORDER BY avg_duration_seconds DESC
      LIMIT 10
    `);

    const patterns: PatternDetail[] = [];
    for (const row of result.rows) {
      const confidence = Math.min(
        (row.avg_duration_seconds > 3600 ? 0.5 : 0.2) + row.failure_rate * 0.5,
        1.0,
      );

      const [pattern] = await db
        .insert(workPatterns)
        .values({
          namespaceId: input.namespace_id,
          name: `Bottleneck: ${row.step_name}`,
          description: `Step "${row.step_key}" averages ${Math.round(row.avg_duration_seconds)}s with ${Math.round(row.failure_rate * 100)}% failure rate`,
          patternType: "bottleneck",
          frequency: row.execution_count,
          confidence,
          patternData: {
            step_id: row.step_id,
            step_key: row.step_key,
            avg_duration_seconds: row.avg_duration_seconds,
            failure_rate: row.failure_rate,
          },
        })
        .onConflictDoNothing()
        .returning();

      if (pattern) {
        patterns.push(this.toPatternDetail(pattern));
      }
    }

    return patterns;
  }

  private async analyzeCollaboration(input: AnalyzePatternsInput): Promise<PatternDetail[]> {
    const result = await db.execute<{
      agent_a: string;
      agent_b: string;
      shared_count: number;
    }>(sql`
      SELECT
        a.source_agent AS agent_a,
        b.source_agent AS agent_b,
        COUNT(*)::int AS shared_count
      FROM knowledge_relations kr
      JOIN knowledge_items a ON a.id = kr.source_id
      JOIN knowledge_items b ON b.id = kr.target_id
      WHERE a.namespace_id = ${input.namespace_id}::uuid
        AND a.source_agent IS NOT NULL
        AND b.source_agent IS NOT NULL
        AND a.source_agent != b.source_agent
      GROUP BY a.source_agent, b.source_agent
      HAVING COUNT(*) >= 2
      ORDER BY shared_count DESC
      LIMIT 10
    `);

    const patterns: PatternDetail[] = [];
    for (const row of result.rows) {
      const [pattern] = await db
        .insert(workPatterns)
        .values({
          namespaceId: input.namespace_id,
          name: `Collaboration: ${row.agent_a} <-> ${row.agent_b}`,
          description: `${row.agent_a} and ${row.agent_b} share ${row.shared_count} knowledge relations`,
          patternType: "collaboration",
          frequency: row.shared_count,
          confidence: Math.min(row.shared_count / 10, 1.0),
          patternData: {
            agent_a: row.agent_a,
            agent_b: row.agent_b,
            interaction_count: row.shared_count,
          },
        })
        .onConflictDoNothing()
        .returning();

      if (pattern) {
        patterns.push(this.toPatternDetail(pattern));
      }
    }

    return patterns;
  }

  private async analyzeKnowledgeClusters(input: AnalyzePatternsInput): Promise<PatternDetail[]> {
    const result = await db.execute<{
      node_id: string;
      title: string | null;
      connection_count: number;
      connected_ids: string[];
    }>(sql`
      WITH connections AS (
        SELECT
          ki.id AS node_id,
          ki.title,
          COUNT(DISTINCT CASE WHEN kr.source_id = ki.id THEN kr.target_id ELSE kr.source_id END)::int AS connection_count,
          array_agg(DISTINCT CASE WHEN kr.source_id = ki.id THEN kr.target_id ELSE kr.source_id END) AS connected_ids
        FROM knowledge_items ki
        JOIN knowledge_relations kr ON kr.source_id = ki.id OR kr.target_id = ki.id
        WHERE ki.namespace_id = ${input.namespace_id}::uuid
        GROUP BY ki.id, ki.title
        HAVING COUNT(DISTINCT CASE WHEN kr.source_id = ki.id THEN kr.target_id ELSE kr.source_id END) >= 3
      )
      SELECT * FROM connections ORDER BY connection_count DESC LIMIT 10
    `);

    const patterns: PatternDetail[] = [];
    for (const row of result.rows) {
      const [pattern] = await db
        .insert(workPatterns)
        .values({
          namespaceId: input.namespace_id,
          name: `Knowledge Hub: ${row.title ?? row.node_id}`,
          description: `Knowledge node with ${row.connection_count} connections, acting as a hub in the graph`,
          patternType: "knowledge_cluster",
          frequency: row.connection_count,
          confidence: Math.min(row.connection_count / 10, 1.0),
          patternData: {
            hub_node_id: row.node_id,
            hub_title: row.title,
            connection_count: row.connection_count,
            connected_node_ids: row.connected_ids,
          },
        })
        .onConflictDoNothing()
        .returning();

      if (pattern) {
        patterns.push(this.toPatternDetail(pattern));
      }
    }

    return patterns;
  }

  async listPatterns(filters: {
    namespace_id?: string;
    pattern_type?: string;
    min_confidence?: number;
    pagination: PaginationParams;
  }) {
    const conditions = [];

    if (filters.namespace_id) {
      conditions.push(eq(workPatterns.namespaceId, filters.namespace_id));
    }
    if (filters.pattern_type) {
      conditions.push(eq(workPatterns.patternType, filters.pattern_type));
    }
    if (filters.min_confidence !== undefined) {
      conditions.push(gte(workPatterns.confidence, filters.min_confidence));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(workPatterns)
        .where(whereClause)
        .orderBy(desc(workPatterns.frequency))
        .limit(filters.pagination.limit)
        .offset(filters.pagination.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(workPatterns)
        .where(whereClause),
    ]);

    return {
      data: data.map(this.toPatternDetail),
      total: countResult[0]?.count ?? 0,
      limit: filters.pagination.limit,
      offset: filters.pagination.offset,
    };
  }

  async getPatternById(id: string): Promise<PatternDetail | null> {
    const [pattern] = await db
      .select()
      .from(workPatterns)
      .where(eq(workPatterns.id, id))
      .limit(1);

    return pattern ? this.toPatternDetail(pattern) : null;
  }

  async recommend(req: PatternRecommendRequest): Promise<PatternDetail[]> {
    const limit = req.limit ?? 5;

    const conditions = [eq(workPatterns.namespaceId, req.namespace_id)];

    const whereClause = and(...conditions);

    const data = await db
      .select()
      .from(workPatterns)
      .where(whereClause)
      .orderBy(desc(workPatterns.confidence), desc(workPatterns.frequency))
      .limit(limit);

    return data.map(this.toPatternDetail);
  }

  private toPatternDetail(row: {
    id: string;
    namespaceId: string;
    name: string;
    description: string | null;
    patternType: string;
    frequency: number | null;
    confidence: number | null;
    patternData: unknown;
    sourceExecutionIds: string[] | null;
    discoveredAt: Date;
    lastSeenAt: Date;
  }): PatternDetail {
    return {
      id: row.id,
      namespace_id: row.namespaceId,
      name: row.name,
      description: row.description,
      pattern_type: row.patternType,
      frequency: row.frequency ?? 0,
      confidence: row.confidence ?? 0,
      pattern_data: (row.patternData as Record<string, unknown>) ?? {},
      source_execution_ids: row.sourceExecutionIds,
      discovered_at: row.discoveredAt,
      last_seen_at: row.lastSeenAt,
    };
  }
}
