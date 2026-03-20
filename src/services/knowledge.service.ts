import { eq, and, sql, inArray, desc } from "drizzle-orm";
import { db } from "../db/connection.js";
import { knowledgeItems, namespaces, collections, attachments } from "../db/schema.js";
import type { CreateKnowledgeInput, UpdateKnowledgeInput, PaginationParams } from "../types/index.js";
import type { EmbeddingProvider } from "../types/index.js";

export class KnowledgeService {
  constructor(private embeddingProvider: EmbeddingProvider) {}

  async create(input: CreateKnowledgeInput) {
    const embedding = await this.embeddingProvider.embed(
      `${input.title ?? ""} ${input.content}`.trim(),
    );

    const [item] = await db
      .insert(knowledgeItems)
      .values({
        namespaceId: input.namespace_id,
        collectionId: input.collection_id,
        title: input.title,
        content: input.content,
        contentType: input.content_type ?? "text",
        structuredData: input.structured_data,
        embedding,
        tags: input.tags ?? [],
        sourceAgent: input.source_agent,
        sourceContext: input.source_context,
        metadata: input.metadata ?? {},
      })
      .returning();

    return item!;
  }

  async getById(id: string) {
    const [item] = await db
      .select()
      .from(knowledgeItems)
      .where(eq(knowledgeItems.id, id))
      .limit(1);

    return item ?? null;
  }

  async update(id: string, input: UpdateKnowledgeInput) {
    let embedding: number[] | undefined;

    if (input.content !== undefined) {
      embedding = await this.embeddingProvider.embed(
        `${input.title ?? ""} ${input.content}`.trim(),
      );
    }

    const [item] = await db
      .update(knowledgeItems)
      .set({
        ...(input.title !== undefined && { title: input.title }),
        ...(input.content !== undefined && { content: input.content }),
        ...(input.content_type !== undefined && { contentType: input.content_type }),
        ...(input.structured_data !== undefined && { structuredData: input.structured_data }),
        ...(input.tags !== undefined && { tags: input.tags }),
        ...(input.metadata !== undefined && { metadata: input.metadata }),
        ...(embedding && { embedding }),
        updatedAt: new Date(),
      })
      .where(eq(knowledgeItems.id, id))
      .returning();

    return item ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(knowledgeItems)
      .where(eq(knowledgeItems.id, id))
      .returning({ id: knowledgeItems.id });

    return result.length > 0;
  }

  async list(filters: {
    namespace_id?: string;
    collection_id?: string;
    source_agent?: string;
    content_type?: string;
    tags?: string[];
    pagination: PaginationParams;
  }) {
    const conditions = [];

    if (filters.namespace_id) {
      conditions.push(eq(knowledgeItems.namespaceId, filters.namespace_id));
    }
    if (filters.collection_id) {
      conditions.push(eq(knowledgeItems.collectionId, filters.collection_id));
    }
    if (filters.source_agent) {
      conditions.push(eq(knowledgeItems.sourceAgent, filters.source_agent));
    }
    if (filters.content_type) {
      conditions.push(eq(knowledgeItems.contentType, filters.content_type));
    }
    if (filters.tags && filters.tags.length > 0) {
      conditions.push(sql`${knowledgeItems.tags} && ${filters.tags}`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(knowledgeItems)
        .where(whereClause)
        .orderBy(desc(knowledgeItems.createdAt))
        .limit(filters.pagination.limit)
        .offset(filters.pagination.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(knowledgeItems)
        .where(whereClause),
    ]);

    return {
      data,
      total: countResult[0]?.count ?? 0,
      limit: filters.pagination.limit,
      offset: filters.pagination.offset,
    };
  }

  // ── Namespace CRUD ──────────────────────────────────────

  async createNamespace(name: string, description?: string) {
    const [ns] = await db
      .insert(namespaces)
      .values({ name, description })
      .returning();
    return ns!;
  }

  async listNamespaces() {
    return db.select().from(namespaces).orderBy(namespaces.name);
  }

  async getNamespaceByName(name: string) {
    const [ns] = await db
      .select()
      .from(namespaces)
      .where(eq(namespaces.name, name))
      .limit(1);
    return ns ?? null;
  }

  // ── Collection CRUD ─────────────────────────────────────

  async createCollection(namespaceId: string, name: string, description?: string, metadata?: Record<string, unknown>) {
    const [coll] = await db
      .insert(collections)
      .values({ namespaceId, name, description, metadata: metadata ?? {} })
      .returning();
    return coll!;
  }

  async listCollections(namespaceId?: string) {
    if (namespaceId) {
      return db
        .select()
        .from(collections)
        .where(eq(collections.namespaceId, namespaceId))
        .orderBy(collections.name);
    }
    return db.select().from(collections).orderBy(collections.name);
  }

  async getCollectionById(id: string) {
    const [coll] = await db
      .select()
      .from(collections)
      .where(eq(collections.id, id))
      .limit(1);
    return coll ?? null;
  }

  // ── Attachment helpers ──────────────────────────────────

  async createAttachment(data: {
    knowledgeItemId?: string;
    filename: string;
    mimeType?: string;
    sizeBytes?: number;
    storageKey: string;
    uploadedBy?: string;
  }) {
    const [att] = await db
      .insert(attachments)
      .values({
        knowledgeItemId: data.knowledgeItemId,
        filename: data.filename,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        storageKey: data.storageKey,
        uploadedBy: data.uploadedBy,
      })
      .returning();
    return att!;
  }

  async getAttachmentById(id: string) {
    const [att] = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, id))
      .limit(1);
    return att ?? null;
  }

  async deleteAttachment(id: string): Promise<string | null> {
    const [att] = await db
      .delete(attachments)
      .where(eq(attachments.id, id))
      .returning({ storageKey: attachments.storageKey });
    return att?.storageKey ?? null;
  }
}
