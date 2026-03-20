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

  console.log("Migrations completed successfully.");
  await client.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
