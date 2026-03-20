import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://synapse:synapse@localhost:5432/synapsehub";
const EMBEDDING_DIMENSION = Number(process.env.EMBEDDING_DIMENSION ?? 128);

/**
 * Run raw SQL migrations instead of drizzle-kit push to have full control
 * over pgvector-specific DDL (vector columns, IVFFlat indexes).
 */
async function migrate() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  console.log("Running migrations...");

  await client.query("CREATE EXTENSION IF NOT EXISTS vector;");
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm;");

  await client.query(`
    CREATE TABLE IF NOT EXISTS namespaces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS namespaces_name_idx ON namespaces(name);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key_prefix VARCHAR(12) NOT NULL,
      key_hash VARCHAR(255) NOT NULL,
      agent_name VARCHAR(255) NOT NULL,
      namespace_id UUID NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
      permissions JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS api_keys_namespace_idx ON api_keys(namespace_id);
    CREATE INDEX IF NOT EXISTS api_keys_prefix_idx ON api_keys(key_prefix);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS collections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      namespace_id UUID NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS collections_namespace_idx ON collections(namespace_id);
    CREATE UNIQUE INDEX IF NOT EXISTS collections_ns_name_idx ON collections(namespace_id, name);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS knowledge_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      namespace_id UUID NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
      collection_id UUID REFERENCES collections(id) ON DELETE SET NULL,
      title VARCHAR(500),
      content TEXT NOT NULL,
      content_type VARCHAR(50) NOT NULL DEFAULT 'text',
      structured_data JSONB,
      embedding vector(${EMBEDDING_DIMENSION}),
      tags TEXT[] DEFAULT '{}',
      source_agent VARCHAR(255),
      source_context JSONB,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ki_namespace_idx ON knowledge_items(namespace_id);
    CREATE INDEX IF NOT EXISTS ki_collection_idx ON knowledge_items(collection_id);
    CREATE INDEX IF NOT EXISTS ki_source_agent_idx ON knowledge_items(source_agent);
    CREATE INDEX IF NOT EXISTS ki_content_type_idx ON knowledge_items(content_type);
  `);

  // Full-text search index
  await client.query(`
    CREATE INDEX IF NOT EXISTS ki_fulltext_idx
    ON knowledge_items
    USING gin(to_tsvector('english', coalesce(title, '') || ' ' || content));
  `);

  // GIN index on tags array
  await client.query(`
    CREATE INDEX IF NOT EXISTS ki_tags_idx ON knowledge_items USING gin(tags);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      knowledge_item_id UUID REFERENCES knowledge_items(id) ON DELETE CASCADE,
      filename VARCHAR(500) NOT NULL,
      mime_type VARCHAR(255),
      size_bytes BIGINT,
      storage_key VARCHAR(500) NOT NULL,
      uploaded_by VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS attachments_ki_idx ON attachments(knowledge_item_id);
  `);

  // ── Knowledge Relations (Graph Edges) ─────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS knowledge_relations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source_id UUID NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
      target_id UUID NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
      relation_type VARCHAR(100) NOT NULL,
      weight REAL DEFAULT 1.0,
      metadata JSONB DEFAULT '{}',
      created_by VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS kr_source_idx ON knowledge_relations(source_id);
    CREATE INDEX IF NOT EXISTS kr_target_idx ON knowledge_relations(target_id);
    CREATE INDEX IF NOT EXISTS kr_type_idx ON knowledge_relations(relation_type);
    CREATE UNIQUE INDEX IF NOT EXISTS kr_source_target_type_idx ON knowledge_relations(source_id, target_id, relation_type);
  `);

  // ── Workflow Templates ──────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS workflow_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      namespace_id UUID NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      status VARCHAR(50) NOT NULL DEFAULT 'draft',
      trigger_conditions JSONB,
      metadata JSONB DEFAULT '{}',
      created_by VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wt_namespace_idx ON workflow_templates(namespace_id);
    CREATE INDEX IF NOT EXISTS wt_status_idx ON workflow_templates(status);
  `);

  // ── Workflow Steps ──────────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS workflow_steps (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
      step_key VARCHAR(100) NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      step_type VARCHAR(50) NOT NULL,
      config JSONB DEFAULT '{}',
      knowledge_item_id UUID REFERENCES knowledge_items(id) ON DELETE SET NULL,
      position JSONB,
      metadata JSONB DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS ws_template_idx ON workflow_steps(template_id);
    CREATE UNIQUE INDEX IF NOT EXISTS ws_template_key_idx ON workflow_steps(template_id, step_key);
  `);

  // ── Workflow Step Edges (DAG) ───────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS workflow_step_edges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
      from_step_id UUID NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
      to_step_id UUID NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
      condition JSONB,
      label VARCHAR(255)
    );
    CREATE INDEX IF NOT EXISTS wse_template_idx ON workflow_step_edges(template_id);
    CREATE INDEX IF NOT EXISTS wse_from_idx ON workflow_step_edges(from_step_id);
    CREATE INDEX IF NOT EXISTS wse_to_idx ON workflow_step_edges(to_step_id);
  `);

  // ── Workflow Executions ─────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS workflow_executions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id UUID NOT NULL REFERENCES workflow_templates(id),
      namespace_id UUID NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
      status VARCHAR(50) NOT NULL,
      initiated_by VARCHAR(255),
      context JSONB DEFAULT '{}',
      result JSONB,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS we_template_idx ON workflow_executions(template_id);
    CREATE INDEX IF NOT EXISTS we_namespace_idx ON workflow_executions(namespace_id);
    CREATE INDEX IF NOT EXISTS we_status_idx ON workflow_executions(status);
  `);

  // ── Workflow Step Executions ────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS workflow_step_executions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      execution_id UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
      step_id UUID NOT NULL REFERENCES workflow_steps(id),
      status VARCHAR(50) NOT NULL,
      input JSONB,
      output JSONB,
      error TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS wste_execution_idx ON workflow_step_executions(execution_id);
    CREATE INDEX IF NOT EXISTS wste_step_idx ON workflow_step_executions(step_id);
    CREATE INDEX IF NOT EXISTS wste_status_idx ON workflow_step_executions(status);
  `);

  // ── Work Patterns ───────────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS work_patterns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      namespace_id UUID NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      pattern_type VARCHAR(50) NOT NULL,
      frequency INTEGER DEFAULT 0,
      confidence REAL DEFAULT 0,
      pattern_data JSONB NOT NULL,
      source_execution_ids UUID[],
      discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wp_namespace_idx ON work_patterns(namespace_id);
    CREATE INDEX IF NOT EXISTS wp_type_idx ON work_patterns(pattern_type);
  `);

  console.log("Migrations completed successfully.");
  await client.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
