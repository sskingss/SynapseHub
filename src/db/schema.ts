import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  bigint,
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
