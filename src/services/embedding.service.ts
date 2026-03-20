import { config } from "../config.js";
import type { EmbeddingProvider } from "../types/index.js";

/**
 * Mock embedder for local development and demos.
 * Produces deterministic pseudo-random vectors from text content
 * so that semantically similar texts produce somewhat similar vectors.
 */
class MockEmbeddingProvider implements EmbeddingProvider {
  readonly dimension: number;

  constructor(dimension: number) {
    this.dimension = dimension;
  }

  async embed(text: string): Promise<number[]> {
    return this.deterministicVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.deterministicVector(t));
  }

  private deterministicVector(text: string): number[] {
    const vec: number[] = [];
    const normalized = text.toLowerCase().trim();

    // Simple hash-based approach: create a vector that is partially
    // determined by character n-grams, giving similar texts closer vectors.
    for (let i = 0; i < this.dimension; i++) {
      let hash = 0;
      const window = normalized.slice(i % normalized.length, (i % normalized.length) + 5);
      for (let j = 0; j < window.length; j++) {
        hash = ((hash << 5) - hash + window.charCodeAt(j)) | 0;
      }
      hash = ((hash * 2654435761) >>> 0) + i * 31;
      vec.push(((hash % 10000) / 10000) * 2 - 1);
    }

    // L2 normalize
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    return vec.map((v) => v / (magnitude || 1));
  }
}

/**
 * OpenAI embedding provider using the text-embedding-3-small model.
 */
class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimension: number;
  private apiKey: string;

  constructor(apiKey: string, dimension: number) {
    this.apiKey = apiKey;
    this.dimension = dimension;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0]!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: texts,
        dimensions: this.dimension,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI embedding request failed: ${response.status} ${err}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data.map((d) => d.embedding);
  }
}

/**
 * Ollama embedding provider for local model inference.
 */
class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly dimension: number;
  private baseUrl: string;
  private model: string;

  constructor(baseUrl: string, model: string, dimension: number) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.dimension = dimension;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding failed: ${response.status}`);
    }

    const data = (await response.json()) as { embedding: number[] };
    return data.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

// ── Factory ─────────────────────────────────────────────────

export function createEmbeddingProvider(): EmbeddingProvider {
  const dim = config.EMBEDDING_DIMENSION;

  switch (config.EMBEDDING_PROVIDER) {
    case "openai": {
      if (!config.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai");
      }
      return new OpenAIEmbeddingProvider(config.OPENAI_API_KEY, dim);
    }
    case "ollama": {
      const baseUrl = config.OLLAMA_BASE_URL ?? "http://localhost:11434";
      return new OllamaEmbeddingProvider(baseUrl, config.OLLAMA_MODEL, dim);
    }
    case "mock":
    default:
      return new MockEmbeddingProvider(dim);
  }
}
