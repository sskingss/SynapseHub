# SynapseHub

A shared knowledge platform for agents within an organization. SynapseHub provides a unified REST API that allows both LLM-based agents and traditional services to **store**, **search**, and **retrieve** knowledge — building an ever-growing organizational memory.

## Features

- **Hybrid Search** — Combines vector similarity search (pgvector) with PostgreSQL full-text search, merged via Reciprocal Rank Fusion (RRF)
- **Multi-Tenant** — Namespace isolation for teams, projects, or environments
- **Pluggable Embeddings** — Supports OpenAI, Ollama (local), or a built-in mock provider
- **File Storage** — Pluggable storage supporting Local File System or S3-compatible object storage (MinIO, AWS)
- **Agent Authentication** — API key-based auth with scoped permissions per agent
- **Structured + Unstructured** — Store plain text, markdown, JSON, code snippets, and files
- **Docker Compose** — One command to spin up the entire stack locally

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                        Clients                             │
│   LLM Agents  ·  Microservices  ·  CLI / Scripts           │
└──────────────────────┬─────────────────────────────────────┘
                       │ REST + JSON
┌──────────────────────▼─────────────────────────────────────┐
│                    SynapseHub API                           │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌──────────┐ │
│  │ Knowledge│  │   Search   │  │Embedding │  │ Storage  │ │
│  │ Service  │  │  Service   │  │ Service  │  │ Service  │ │
│  └─────┬────┘  └─────┬──────┘  └─────┬────┘  └─────┬────┘ │
└────────┼─────────────┼───────────────┼──────────────┼──────┘
         │             │               │              │
┌────────▼─────────────▼───┐  ┌────────▼──┐  ┌───────▼──────┐
│  PostgreSQL 16 + pgvector│  │  OpenAI / │  │  Local FS /  │
│  (data + vectors + FTS)  │  │  Ollama / │  │   MinIO      │
│                          │  │  Mock     │  │              │
└──────────────────────────┘  └───────────┘  └──────────────┘
```

### Data Model

- **Namespaces** — Top-level isolation boundary (e.g., per team or project)
- **Collections** — Group related knowledge items within a namespace (like folders)
- **Knowledge Items** — Core entity: text content + optional structured JSON + vector embedding + tags
- **Attachments** — Files linked to knowledge items, stored in MinIO
- **API Keys** — Scoped credentials for each agent, tied to a namespace

### Search Strategy

The hybrid search engine runs three retrieval strategies in parallel and fuses results:

| Strategy | Engine | Best For |
|----------|--------|----------|
| Semantic | pgvector cosine similarity | Natural language queries, conceptual matches |
| Full-text | PostgreSQL `tsvector` / `ts_rank` | Exact keyword matches, technical terms |
| Metadata | SQL WHERE clauses | Tag filters, agent filters, content type filters |

Results are merged using **Reciprocal Rank Fusion (RRF)** with `k=60`, providing a balanced ranking that leverages both meaning and keyword relevance.

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Node.js](https://nodejs.org/) >= 20 (for local development)

### 1. Clone and configure

```bash
git clone <your-repo-url> && cd SynapseHub
cp .env.example .env
```

### 2. Start infrastructure

```bash
# Start PostgreSQL (with pgvector) and MinIO
docker compose up -d postgres minio minio-init
```

### 3. Install dependencies and run migrations

```bash
npm install
npm run db:migrate
```

### 4. Start the server

```bash
npm run dev
```

The server starts at `http://localhost:3777`. Verify with:

```bash
curl http://localhost:3777/health
```

### 5. Run the demo

```bash
npm run demo
```

This runs an end-to-end scenario that creates a namespace, collections, stores knowledge from multiple simulated agents, and performs various search queries.

### Full Docker Compose (including the app)

To run everything in Docker:

```bash
docker compose up --build
```

## API Reference

All protected endpoints require authentication via:
- `Authorization: Bearer <api-key>` header, or
- `X-API-Key: <api-key>` header

The default master key for development is `synapse-dev-master-key` (configured via `MASTER_API_KEY` env var).

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Basic health check |
| `GET` | `/health/ready` | Readiness check (verifies DB connection) |

### Namespaces

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/namespaces` | Create a namespace |
| `GET` | `/api/v1/namespaces` | List all namespaces |

**Create namespace:**

```bash
curl -X POST http://localhost:3777/api/v1/namespaces \
  -H "Authorization: Bearer synapse-dev-master-key" \
  -H "Content-Type: application/json" \
  -d '{"name": "engineering", "description": "Engineering team knowledge"}'
```

### Collections

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/collections` | Create a collection |
| `GET` | `/api/v1/collections` | List collections (optional `?namespace_id=`) |
| `GET` | `/api/v1/collections/:id` | Get a collection by ID |

### Knowledge Items

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/knowledge` | Store a knowledge item (auto-embeds content) |
| `GET` | `/api/v1/knowledge/:id` | Get by ID |
| `PUT` | `/api/v1/knowledge/:id` | Update (re-embeds if content changes) |
| `DELETE` | `/api/v1/knowledge/:id` | Delete |
| `GET` | `/api/v1/knowledge` | List with filters |

**Store knowledge:**

```bash
curl -X POST http://localhost:3777/api/v1/knowledge \
  -H "Authorization: Bearer synapse-dev-master-key" \
  -H "Content-Type: application/json" \
  -d '{
    "namespace_id": "<namespace-uuid>",
    "title": "Rate Limiting Strategy",
    "content": "Our API uses token bucket algorithm with 100 req/s per key...",
    "content_type": "markdown",
    "tags": ["api", "rate-limiting"],
    "source_agent": "architecture-bot",
    "metadata": {"status": "approved"}
  }'
```

**List with filters:**

```bash
curl "http://localhost:3777/api/v1/knowledge?source_agent=architecture-bot&tags=api&limit=10" \
  -H "Authorization: Bearer synapse-dev-master-key"
```

### Search

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/search` | Hybrid search (semantic + full-text + RRF) |
| `POST` | `/api/v1/search/semantic` | Pure vector similarity search |
| `POST` | `/api/v1/search/structured` | Full-text search with metadata filters |

**Search request body:**

```json
{
  "query": "How do we handle authentication?",
  "namespace": "<namespace-uuid>",
  "collection_id": "<collection-uuid>",
  "tags": ["security"],
  "content_type": "markdown",
  "limit": 10,
  "min_score": 0.5,
  "mode": "hybrid"
}
```

**Search response:**

```json
{
  "query": "How do we handle authentication?",
  "mode": "hybrid",
  "count": 2,
  "results": [
    {
      "id": "uuid",
      "title": "User Authentication Flow",
      "content": "Authentication uses JWT tokens with RS256...",
      "content_type": "markdown",
      "tags": ["auth", "security"],
      "source_agent": "security-agent",
      "metadata": {},
      "score": 0.0327,
      "match_type": "hybrid",
      "created_at": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

### Files

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/files/upload` | Upload a file (multipart/form-data) |
| `GET` | `/api/v1/files/:id` | Download a file |
| `DELETE` | `/api/v1/files/:id` | Delete a file |

**Upload a file:**

```bash
curl -X POST http://localhost:3777/api/v1/files/upload \
  -H "Authorization: Bearer synapse-dev-master-key" \
  -F "file=@./document.pdf" \
  -F "knowledge_item_id=<item-uuid>" \
  -F "uploaded_by=my-agent"
```

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3777` | Server port |
| `HOST` | `0.0.0.0` | Server bind address |
| `LOG_LEVEL` | `info` | Log level (fatal/error/warn/info/debug/trace) |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `STORAGE_PROVIDER` | `local` | Storage provider: `s3` or `local` |
| `STORAGE_LOCAL_DIR` | `./uploads` | Directory for `local` storage |
| `S3_ENDPOINT` | — | MinIO/S3 endpoint URL (if STORAGE_PROVIDER=s3) |
| `S3_ACCESS_KEY` | — | S3 access key |
| `S3_SECRET_KEY` | — | S3 secret key |
| `S3_BUCKET` | `synapsehub-files` | S3 bucket name |
| `EMBEDDING_PROVIDER` | `mock` | Embedding provider: `openai`, `ollama`, or `mock` |
| `OPENAI_API_KEY` | — | Required when using OpenAI embeddings |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `nomic-embed-text` | Ollama embedding model |
| `EMBEDDING_DIMENSION` | `128` | Vector dimension (must match provider) |
| `MASTER_API_KEY` | — | Master API key for admin access |

### Embedding Providers

| Provider | Dimension | Notes |
|----------|-----------|-------|
| `mock` | 128 | Deterministic pseudo-random vectors; great for development and testing |
| `openai` | 1536 | Uses `text-embedding-3-small`; requires `OPENAI_API_KEY` |
| `ollama` | 768 | Local inference; requires Ollama running with the configured model |

When switching providers, update `EMBEDDING_DIMENSION` accordingly and re-run migrations to alter the vector column size.

## Development

```bash
# Install dependencies
npm install

# Start infrastructure
docker compose up -d postgres minio minio-init

# Run database migrations
npm run db:migrate

# Start dev server with hot reload
npm run dev

# Type check
npm run typecheck

# Run the demo scenario
npm run demo
```

### Project Structure

```
SynapseHub/
├── docker/
│   ├── Dockerfile                 # Multi-stage production build
│   └── postgres/
│       └── init.sql               # pgvector + pg_trgm extensions
├── src/
│   ├── index.ts                   # Server entry point
│   ├── config.ts                  # Zod-validated environment config
│   ├── db/
│   │   ├── schema.ts              # Drizzle ORM table definitions
│   │   ├── connection.ts          # Database connection pool
│   │   └── migrate.ts             # SQL migration runner
│   ├── routes/
│   │   ├── health.routes.ts       # Health check endpoints
│   │   ├── namespaces.routes.ts   # Namespace management
│   │   ├── collections.routes.ts  # Collection management
│   │   ├── knowledge.routes.ts    # Knowledge CRUD
│   │   ├── search.routes.ts       # Search endpoints
│   │   └── files.routes.ts        # File upload/download
│   ├── services/
│   │   ├── knowledge.service.ts   # Knowledge business logic
│   │   ├── search.service.ts      # Hybrid search with RRF
│   │   ├── embedding.service.ts   # Pluggable embedding providers
│   │   └── storage.service.ts     # S3/MinIO file operations
│   ├── middleware/
│   │   ├── auth.ts                # API key authentication
│   │   └── error-handler.ts       # Centralized error handling
│   └── types/
│       └── index.ts               # Shared TypeScript types
├── demo/
│   └── scenario.ts                # End-to-end demo script
├── docker-compose.yml             # Full stack: PG + MinIO + App
├── package.json
├── tsconfig.json
├── drizzle.config.ts
└── .env.example
```

## Integrating with Your Agents

### Best Practices: When Should Agents Read and Write?

Controlling the timing of knowledge access is crucial for building effective, collaborative agents. Here is the recommended lifecycle for agent interactions with SynapseHub:

**When to Read (Search/Retrieve)**
- **Initialization & Planning (Pre-hook):** Before executing a complex task, automatically query the hub for related context, past similar tasks, or system guidelines to avoid repeating mistakes.
- **Just-in-Time Context (Tool Calling):** During execution, if the agent realizes it lacks specific facts (e.g., "What is the API endpoint for billing?"), it should use the search tool autonomously.
- **Error Recovery:** When encountering a failure, search the knowledge base for the error message or stack trace to see if a fix is already documented.

**When to Write (Store)**
- **Task Completion (Post-hook):** Upon successfully completing a non-trivial task, the agent should summarize the problem, steps taken, and the solution, then store it for future agents.
- **Explicit Instruction:** When a human user explicitly instructs the agent to "remember this," "document this," or "add this to our guidelines."
- **New Discoveries:** When an agent identifies a recurring pattern, a new environment variable, or deduces a rule that isn't currently in its context.

**How to Control the Timing**
1. **System Prompts:** Give your agent clear instructions. Example: *"You share an organizational memory with other agents. Always search for existing solutions before asking the user. If you solve a novel problem, use the store tool to document the solution."*
2. **Autonomous Tool Calling (ReAct):** Expose `search` and `store` as standard tools (see examples below). Modern LLMs are excellent at deciding *when* to call these based on the conversation flow and tool descriptions.
3. **Event-Driven Lifecycle Hooks:** Implement code-level triggers in your application logic. For example, automatically run a semantic search on every new user support ticket, or trigger a background summarization/write job when a thread or task is marked "Resolved".

### Python Agent Example

```python
import requests

SYNAPSEHUB_URL = "http://localhost:3777"
API_KEY = "your-agent-api-key"
HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

# Store knowledge
requests.post(f"{SYNAPSEHUB_URL}/api/v1/knowledge", headers=HEADERS, json={
    "namespace_id": "your-namespace-id",
    "title": "Discovery from data analysis",
    "content": "Customer churn rate increased 15% in Q4...",
    "tags": ["analytics", "churn"],
    "source_agent": "data-analysis-bot"
})

# Search for relevant knowledge
response = requests.post(f"{SYNAPSEHUB_URL}/api/v1/search", headers=HEADERS, json={
    "query": "What do we know about customer churn?",
    "namespace": "your-namespace-id",
    "limit": 5
})
results = response.json()["results"]
```

### LangChain Tool Integration

```python
from langchain.tools import tool

@tool
def search_knowledge(query: str) -> str:
    """Search the organization's knowledge base for relevant information."""
    response = requests.post(f"{SYNAPSEHUB_URL}/api/v1/search", headers=HEADERS, json={
        "query": query,
        "limit": 3
    })
    results = response.json()["results"]
    return "\n\n".join([f"**{r['title']}**: {r['content']}" for r in results])
```

### JavaScript / TypeScript Agent Example

```typescript
import axios from 'axios';

const SYNAPSEHUB_URL = "http://localhost:3777";
const API_KEY = "your-agent-api-key";

const client = axios.create({
  baseURL: SYNAPSEHUB_URL,
  headers: {
    "Authorization": `Bearer ${API_KEY}`,
    "Content-Type": "application/json"
  }
});

// Store knowledge
async function storeKnowledge() {
  await client.post('/api/v1/knowledge', {
    namespace_id: "your-namespace-id",
    title: "System Guidelines",
    content: "All microservices must use structured JSON logging.",
    tags: ["guidelines", "backend"],
    source_agent: "ts-agent"
  });
}

// Search for relevant knowledge
async function searchKnowledge(query: string) {
  const { data } = await client.post('/api/v1/search', {
    query,
    namespace: "your-namespace-id",
    limit: 5
  });
  return data.results;
}
```

### OpenAI Tool Calling Integration

```python
import json

# Define the tool schema for OpenAI
tools = [
    {
        "type": "function",
        "function": {
            "name": "search_synapsehub",
            "description": "Search the organization's knowledge base for relevant context.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query, e.g. 'How does authentication work?'"
                    }
                },
                "required": ["query"]
            }
        }
    }
]

# When OpenAI returns a tool call for 'search_synapsehub', execute this:
def execute_search_tool(query):
    response = requests.post(f"{SYNAPSEHUB_URL}/api/v1/search", headers=HEADERS, json={
        "query": query,
        "limit": 3
    })
    results = response.json().get("results", [])
    return json.dumps([{"title": r["title"], "content": r["content"]} for r in results])
```

### cURL Quick Reference

```bash
# Create namespace
curl -X POST localhost:3777/api/v1/namespaces \
  -H "Authorization: Bearer synapse-dev-master-key" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-team"}'

# Store knowledge
curl -X POST localhost:3777/api/v1/knowledge \
  -H "Authorization: Bearer synapse-dev-master-key" \
  -H "Content-Type: application/json" \
  -d '{"namespace_id": "UUID", "content": "Important knowledge...", "tags": ["tag1"]}'

# Search
curl -X POST localhost:3777/api/v1/search \
  -H "Authorization: Bearer synapse-dev-master-key" \
  -H "Content-Type: application/json" \
  -d '{"query": "your search query", "namespace": "UUID"}'
```

## License

MIT
