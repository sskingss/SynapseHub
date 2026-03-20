import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  bigint,
  integer,
  real,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";

/**
 * Custom pgvector column type.
 * Stores float[] as a pgvector `vector(N)` column for similarity search.
 */
const vector = customType<{ data: number[]; driverParam: string }>({
  dataType() {
    return "vector";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: unknown): number[] {
    const str = String(value);
    return str
      .slice(1, -1)
      .split(",")
      .map(Number);
  },
});

// ── Namespaces ──────────────────────────────────────────────

export const namespaces = pgTable(
  "namespaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("namespaces_name_idx").on(table.name),
  ],
);

// ── API Keys ────────────────────────────────────────────────

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    keyPrefix: varchar("key_prefix", { length: 12 }).notNull(),
    keyHash: varchar("key_hash", { length: 255 }).notNull(),
    agentName: varchar("agent_name", { length: 255 }).notNull(),
    namespaceId: uuid("namespace_id").references(() => namespaces.id, { onDelete: "cascade" }).notNull(),
    permissions: jsonb("permissions").$type<string[]>().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("api_keys_namespace_idx").on(table.namespaceId),
    index("api_keys_prefix_idx").on(table.keyPrefix),
  ],
);

// ── Collections ─────────────────────────────────────────────

export const collections = pgTable(
  "collections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    namespaceId: uuid("namespace_id").references(() => namespaces.id, { onDelete: "cascade" }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("collections_namespace_idx").on(table.namespaceId),
    uniqueIndex("collections_ns_name_idx").on(table.namespaceId, table.name),
  ],
);

// ── Knowledge Items ─────────────────────────────────────────

export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    namespaceId: uuid("namespace_id").references(() => namespaces.id, { onDelete: "cascade" }).notNull(),
    collectionId: uuid("collection_id").references(() => collections.id, { onDelete: "set null" }),
    title: varchar("title", { length: 500 }),
    content: text("content").notNull(),
    contentType: varchar("content_type", { length: 50 }).default("text").notNull(),
    structuredData: jsonb("structured_data").$type<Record<string, unknown>>(),
    embedding: vector("embedding"),
    tags: text("tags").array().default([]).notNull(),
    sourceAgent: varchar("source_agent", { length: 255 }),
    sourceContext: jsonb("source_context").$type<Record<string, unknown>>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ki_namespace_idx").on(table.namespaceId),
    index("ki_collection_idx").on(table.collectionId),
    index("ki_source_agent_idx").on(table.sourceAgent),
    index("ki_content_type_idx").on(table.contentType),
  ],
);

// ── Attachments ─────────────────────────────────────────────

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    knowledgeItemId: uuid("knowledge_item_id").references(() => knowledgeItems.id, { onDelete: "cascade" }),
    filename: varchar("filename", { length: 500 }).notNull(),
    mimeType: varchar("mime_type", { length: 255 }),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    storageKey: varchar("storage_key", { length: 500 }).notNull(),
    uploadedBy: varchar("uploaded_by", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("attachments_ki_idx").on(table.knowledgeItemId),
  ],
);

// ── Knowledge Relations (Graph Edges) ───────────────────────

export const knowledgeRelations = pgTable(
  "knowledge_relations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id").references(() => knowledgeItems.id, { onDelete: "cascade" }).notNull(),
    targetId: uuid("target_id").references(() => knowledgeItems.id, { onDelete: "cascade" }).notNull(),
    relationType: varchar("relation_type", { length: 100 }).notNull(),
    weight: real("weight").default(1.0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdBy: varchar("created_by", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("kr_source_idx").on(table.sourceId),
    index("kr_target_idx").on(table.targetId),
    index("kr_type_idx").on(table.relationType),
    uniqueIndex("kr_source_target_type_idx").on(table.sourceId, table.targetId, table.relationType),
  ],
);

// ── Workflow Templates ──────────────────────────────────────

export const workflowTemplates = pgTable(
  "workflow_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    namespaceId: uuid("namespace_id").references(() => namespaces.id, { onDelete: "cascade" }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    version: integer("version").default(1).notNull(),
    status: varchar("status", { length: 50 }).default("draft").notNull(),
    triggerConditions: jsonb("trigger_conditions").$type<Record<string, unknown>>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdBy: varchar("created_by", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("wt_namespace_idx").on(table.namespaceId),
    index("wt_status_idx").on(table.status),
  ],
);

// ── Workflow Steps ──────────────────────────────────────────

export const workflowSteps = pgTable(
  "workflow_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: uuid("template_id").references(() => workflowTemplates.id, { onDelete: "cascade" }).notNull(),
    stepKey: varchar("step_key", { length: 100 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    stepType: varchar("step_type", { length: 50 }).notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().default({}),
    knowledgeItemId: uuid("knowledge_item_id").references(() => knowledgeItems.id, { onDelete: "set null" }),
    position: jsonb("position").$type<{ x: number; y: number }>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  },
  (table) => [
    index("ws_template_idx").on(table.templateId),
    uniqueIndex("ws_template_key_idx").on(table.templateId, table.stepKey),
  ],
);

// ── Workflow Step Edges (DAG) ───────────────────────────────

export const workflowStepEdges = pgTable(
  "workflow_step_edges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: uuid("template_id").references(() => workflowTemplates.id, { onDelete: "cascade" }).notNull(),
    fromStepId: uuid("from_step_id").references(() => workflowSteps.id, { onDelete: "cascade" }).notNull(),
    toStepId: uuid("to_step_id").references(() => workflowSteps.id, { onDelete: "cascade" }).notNull(),
    condition: jsonb("condition").$type<Record<string, unknown>>(),
    label: varchar("label", { length: 255 }),
  },
  (table) => [
    index("wse_template_idx").on(table.templateId),
    index("wse_from_idx").on(table.fromStepId),
    index("wse_to_idx").on(table.toStepId),
  ],
);

// ── Workflow Executions ─────────────────────────────────────

export const workflowExecutions = pgTable(
  "workflow_executions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: uuid("template_id").references(() => workflowTemplates.id).notNull(),
    namespaceId: uuid("namespace_id").references(() => namespaces.id, { onDelete: "cascade" }).notNull(),
    status: varchar("status", { length: 50 }).notNull(),
    initiatedBy: varchar("initiated_by", { length: 255 }),
    context: jsonb("context").$type<Record<string, unknown>>().default({}),
    result: jsonb("result").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("we_template_idx").on(table.templateId),
    index("we_namespace_idx").on(table.namespaceId),
    index("we_status_idx").on(table.status),
  ],
);

// ── Workflow Step Executions ────────────────────────────────

export const workflowStepExecutions = pgTable(
  "workflow_step_executions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    executionId: uuid("execution_id").references(() => workflowExecutions.id, { onDelete: "cascade" }).notNull(),
    stepId: uuid("step_id").references(() => workflowSteps.id).notNull(),
    status: varchar("status", { length: 50 }).notNull(),
    input: jsonb("input").$type<Record<string, unknown>>(),
    output: jsonb("output").$type<Record<string, unknown>>(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("wste_execution_idx").on(table.executionId),
    index("wste_step_idx").on(table.stepId),
    index("wste_status_idx").on(table.status),
  ],
);

// ── Work Patterns ───────────────────────────────────────────

export const workPatterns = pgTable(
  "work_patterns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    namespaceId: uuid("namespace_id").references(() => namespaces.id, { onDelete: "cascade" }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    patternType: varchar("pattern_type", { length: 50 }).notNull(),
    frequency: integer("frequency").default(0),
    confidence: real("confidence").default(0),
    patternData: jsonb("pattern_data").$type<Record<string, unknown>>().notNull(),
    sourceExecutionIds: uuid("source_execution_ids").array(),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("wp_namespace_idx").on(table.namespaceId),
    index("wp_type_idx").on(table.patternType),
  ],
);
