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
