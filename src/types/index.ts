export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface SearchRequest {
  query: string;
  namespace?: string;
  collection_id?: string;
  tags?: string[];
  content_type?: string;
  limit?: number;
  min_score?: number;
  mode?: "hybrid" | "semantic" | "fulltext";
}

export interface SearchResult {
  id: string;
  title: string | null;
  content: string;
  content_type: string;
  tags: string[];
  source_agent: string | null;
  metadata: Record<string, unknown>;
  score: number;
  match_type: "semantic" | "fulltext" | "hybrid";
  created_at: Date;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimension: number;
}

export interface StorageProvider {
  upload(key: string, body: Buffer | Uint8Array, contentType?: string): Promise<void>;
  download(key: string): Promise<{ body: ReadableStream | NodeJS.ReadableStream; contentType?: string }>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export interface CreateKnowledgeInput {
  namespace_id: string;
  collection_id?: string;
  title?: string;
  content: string;
  content_type?: string;
  structured_data?: Record<string, unknown>;
  tags?: string[];
  source_agent?: string;
  source_context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface UpdateKnowledgeInput {
  title?: string;
  content?: string;
  content_type?: string;
  structured_data?: Record<string, unknown>;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

// ── Graph Relation Types ────────────────────────────────────

export type RelationType =
  | "depends_on"
  | "references"
  | "part_of"
  | "derived_from"
  | "supersedes"
  | "precedes"
  | string;

export interface CreateRelationInput {
  source_id: string;
  target_id: string;
  relation_type: RelationType;
  weight?: number;
  metadata?: Record<string, unknown>;
  created_by?: string;
}

export interface GraphNeighborsRequest {
  node_id: string;
  direction?: "outgoing" | "incoming" | "both";
  relation_type?: string;
  depth?: number;
  limit?: number;
}

export interface GraphPathRequest {
  source_id: string;
  target_id: string;
  max_depth?: number;
  relation_types?: string[];
}

export interface SubgraphRequest {
  node_id: string;
  depth?: number;
  relation_types?: string[];
  limit?: number;
}

export interface GraphNode {
  id: string;
  title: string | null;
  content_type: string;
  tags: string[];
  source_agent: string | null;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  weight: number | null;
  metadata: Record<string, unknown>;
}

export interface SubgraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  center_node_id: string;
}

export interface GraphPathResponse {
  path: string[];
  edges: GraphEdge[];
  depth: number;
}

// ── Workflow Types ───────────────────────────────────────────

export type WorkflowStatus = "draft" | "active" | "archived";
export type StepType = "manual" | "automated" | "approval" | "notification";
export type ExecutionStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type StepExecutionStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface CreateWorkflowInput {
  namespace_id: string;
  name: string;
  description?: string;
  trigger_conditions?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  created_by?: string;
  steps: CreateWorkflowStepInput[];
  edges: CreateWorkflowEdgeInput[];
}

export interface CreateWorkflowStepInput {
  step_key: string;
  name: string;
  description?: string;
  step_type: StepType;
  config?: Record<string, unknown>;
  knowledge_item_id?: string;
  position?: { x: number; y: number };
  metadata?: Record<string, unknown>;
}

export interface CreateWorkflowEdgeInput {
  from_step_key: string;
  to_step_key: string;
  condition?: Record<string, unknown>;
  label?: string;
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  status?: WorkflowStatus;
  trigger_conditions?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  steps?: CreateWorkflowStepInput[];
  edges?: CreateWorkflowEdgeInput[];
}

export interface ExecuteWorkflowInput {
  initiated_by?: string;
  context?: Record<string, unknown>;
}

export interface CompleteStepInput {
  output?: Record<string, unknown>;
  error?: string;
  status?: "completed" | "failed" | "skipped";
}

export interface WorkflowDetail {
  id: string;
  namespace_id: string;
  name: string;
  description: string | null;
  version: number;
  status: string;
  trigger_conditions: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  steps: WorkflowStepDetail[];
  edges: WorkflowEdgeDetail[];
}

export interface WorkflowStepDetail {
  id: string;
  step_key: string;
  name: string;
  description: string | null;
  step_type: string;
  config: Record<string, unknown>;
  knowledge_item_id: string | null;
  position: { x: number; y: number } | null;
  metadata: Record<string, unknown>;
}

export interface WorkflowEdgeDetail {
  id: string;
  from_step_id: string;
  to_step_id: string;
  condition: Record<string, unknown> | null;
  label: string | null;
}

export interface ExecutionDetail {
  id: string;
  template_id: string;
  namespace_id: string;
  status: string;
  initiated_by: string | null;
  context: Record<string, unknown>;
  result: Record<string, unknown> | null;
  started_at: Date;
  completed_at: Date | null;
  step_executions: StepExecutionDetail[];
}

export interface StepExecutionDetail {
  id: string;
  step_id: string;
  step_key?: string;
  step_name?: string;
  status: string;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  started_at: Date | null;
  completed_at: Date | null;
}

// ── Pattern Types ───────────────────────────────────────────

export type PatternType = "sequence" | "bottleneck" | "collaboration" | "knowledge_cluster";

export interface AnalyzePatternsInput {
  namespace_id: string;
  pattern_types?: PatternType[];
  min_frequency?: number;
  min_confidence?: number;
}

export interface PatternRecommendRequest {
  namespace_id: string;
  context?: Record<string, unknown>;
  tags?: string[];
  limit?: number;
}

export interface PatternDetail {
  id: string;
  namespace_id: string;
  name: string;
  description: string | null;
  pattern_type: string;
  frequency: number;
  confidence: number;
  pattern_data: Record<string, unknown>;
  source_execution_ids: string[] | null;
  discovered_at: Date;
  last_seen_at: Date;
}

// ── Enhanced Search Types ───────────────────────────────────

export interface GraphSearchRequest extends SearchRequest {
  include_relations?: boolean;
  relation_depth?: number;
}

export interface GraphSearchResult extends SearchResult {
  related_items?: {
    item: GraphNode;
    relation: GraphEdge;
  }[];
}
