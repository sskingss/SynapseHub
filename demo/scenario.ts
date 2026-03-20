/**
 * SynapseHub Demo Scenario
 *
 * Simulates multiple agents within an organization storing and
 * retrieving knowledge through the SynapseHub REST API.
 *
 * Usage:
 *   1. Start infrastructure: docker compose up -d postgres minio minio-init
 *   2. Run migrations:       npm run db:migrate
 *   3. Start the server:     npm run dev
 *   4. Run this demo:        npm run demo
 */

const BASE_URL = process.env.SYNAPSEHUB_URL ?? "http://localhost:3777";
const API_KEY = process.env.SYNAPSEHUB_API_KEY ?? "synapse-dev-master-key";

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${API_KEY}`,
};

// ── Helpers ───────────────────────────────────────────────

async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`${method} ${path} failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data as T;
}

function log(section: string, message: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  [${section}] ${message}`);
  console.log("─".repeat(60));
}

function printResults(label: string, data: unknown) {
  console.log(`\n  ${label}:`);
  console.log(JSON.stringify(data, null, 2).split("\n").map((l) => `    ${l}`).join("\n"));
}

// ── Demo Data ────────────────────────────────────────────

const KNOWLEDGE_ITEMS = [
  {
    title: "Rate Limiting Strategy for Payment Service",
    content:
      "Our payment service uses a token bucket algorithm with a rate of 100 requests per second per API key. " +
      "Burst allowance is 150 requests. When exceeded, the service returns HTTP 429 with a Retry-After header. " +
      "The rate limiter state is stored in Redis with a TTL of 60 seconds. " +
      "For critical payment processing endpoints, we use a separate higher-limit bucket.",
    content_type: "markdown" as const,
    tags: ["payment", "rate-limiting", "infrastructure", "redis"],
    source_agent: "architecture-bot",
    metadata: { decision_date: "2025-11-15", status: "approved" },
  },
  {
    title: "User Authentication Flow",
    content:
      "Authentication uses JWT tokens with RS256 signing. Access tokens expire in 15 minutes, " +
      "refresh tokens in 7 days. The auth service validates tokens against a JWKS endpoint. " +
      "Multi-factor authentication is enforced for admin roles using TOTP. " +
      "Session invalidation is handled via a Redis-backed blocklist.",
    content_type: "markdown" as const,
    tags: ["auth", "security", "jwt", "architecture"],
    source_agent: "security-agent",
    metadata: { last_audit: "2025-12-01" },
  },
  {
    title: "Database Migration Best Practices",
    content:
      "All database migrations must be backward-compatible and follow the expand-contract pattern. " +
      "Step 1: Add new columns/tables (expand). Step 2: Migrate data and update application code. " +
      "Step 3: Remove old columns/tables (contract). Each migration must have a corresponding rollback script. " +
      "Use advisory locks to prevent concurrent migration execution.",
    content_type: "markdown" as const,
    tags: ["database", "migration", "best-practices", "postgresql"],
    source_agent: "devops-bot",
    metadata: { category: "engineering-standards" },
  },
  {
    title: "Incident Report: Payment Service Outage 2025-10-20",
    content:
      "Root cause: A misconfigured connection pool in the payment service caused connection exhaustion " +
      "under high load. The pool was set to max 10 connections but the service needed 50+ during peak. " +
      "Resolution: Increased pool size to 100, added connection timeout of 5s, and implemented " +
      "circuit breaker pattern. Impact: 23 minutes of degraded service, ~$45k in delayed transactions.",
    content_type: "text" as const,
    tags: ["incident", "payment", "postmortem", "connection-pool"],
    source_agent: "incident-bot",
    metadata: { severity: "high", resolved: true },
  },
  {
    title: "API Versioning Strategy",
    content:
      "We use URL-based versioning (e.g., /api/v1/, /api/v2/). Each major version is supported " +
      "for at least 12 months after the next version is released. Deprecation notices are sent " +
      "via the Deprecation HTTP header. Breaking changes require a new major version. " +
      "Non-breaking additions (new fields, new endpoints) are allowed within a version.",
    content_type: "markdown" as const,
    tags: ["api", "versioning", "standards", "architecture"],
    source_agent: "architecture-bot",
    metadata: { category: "engineering-standards" },
  },
  {
    title: "Kubernetes Pod Resource Limits",
    content:
      "Standard resource allocation per service tier: " +
      "Tier 1 (critical): 2 CPU / 4Gi memory, min replicas 3. " +
      "Tier 2 (standard): 1 CPU / 2Gi memory, min replicas 2. " +
      "Tier 3 (batch/background): 0.5 CPU / 1Gi memory, min replicas 1. " +
      "HPA is configured to scale up at 70% CPU utilization. All pods must define both requests and limits.",
    content_type: "text" as const,
    tags: ["kubernetes", "infrastructure", "resources", "scaling"],
    source_agent: "devops-bot",
    metadata: { environment: "production" },
  },
  {
    title: "Frontend Error Tracking Setup",
    content:
      "We use Sentry for frontend error tracking. Source maps are uploaded during CI/CD builds. " +
      "Error grouping is configured by fingerprint rules in sentry.config.ts. " +
      "Alert thresholds: >50 errors/min triggers P1 page, >10 errors/min triggers Slack notification. " +
      "User session replay is enabled for 10% of sessions to aid debugging.",
    content_type: "markdown" as const,
    tags: ["frontend", "monitoring", "sentry", "error-tracking"],
    source_agent: "frontend-agent",
    metadata: { stack: "react", "sentry_project": "webapp-prod" },
  },
];

// ── Main Scenario ────────────────────────────────────────

async function runDemo() {
  console.log("\n");
  console.log("  ╔══════════════════════════════════════════════╗");
  console.log("  ║         SynapseHub Demo Scenario             ║");
  console.log("  ╚══════════════════════════════════════════════╝");

  // ── Step 1: Health Check ─────────────────────────────

  log("Step 1", "Checking server health...");
  const health = await api("GET", "/health");
  printResults("Health", health);

  // ── Step 2: Create Namespace ─────────────────────────

  log("Step 2", "Creating namespace 'acme-engineering'...");
  let namespace;
  try {
    namespace = await api("POST", "/api/v1/namespaces", {
      name: "acme-engineering",
      description: "Acme Corp engineering team shared knowledge base",
    });
  } catch {
    // Namespace might already exist from a previous run
    const allNs = await api<any[]>("GET", "/api/v1/namespaces");
    namespace = allNs.find((ns: any) => ns.name === "acme-engineering");
  }
  printResults("Namespace", namespace);

  // ── Step 3: Create Collections ───────────────────────

  log("Step 3", "Creating collections...");
  const collectionDefs = [
    { name: "architecture-decisions", description: "Architecture Decision Records (ADRs)" },
    { name: "incident-reports", description: "Post-incident reports and learnings" },
    { name: "engineering-standards", description: "Team standards and best practices" },
  ];

  const createdCollections: any[] = [];
  for (const def of collectionDefs) {
    try {
      const coll = await api("POST", "/api/v1/collections", {
        namespace_id: namespace.id,
        ...def,
      });
      createdCollections.push(coll);
    } catch {
      // Collection might exist from previous run
      const all = await api<any[]>("GET", `/api/v1/collections?namespace_id=${namespace.id}`);
      const existing = all.find((c: any) => c.name === def.name);
      if (existing) createdCollections.push(existing);
    }
  }
  console.log(`  Created ${createdCollections.length} collections.`);

  // ── Step 4: Store Knowledge ──────────────────────────

  log("Step 4", "Agents storing knowledge items...");
  const storedItems: any[] = [];

  for (const item of KNOWLEDGE_ITEMS) {
    const collName =
      item.tags.includes("incident") || item.tags.includes("postmortem")
        ? "incident-reports"
        : item.metadata?.category === "engineering-standards" || item.tags.includes("best-practices")
          ? "engineering-standards"
          : "architecture-decisions";

    const collection = createdCollections.find((c) => c.name === collName);

    const created = await api("POST", "/api/v1/knowledge", {
      namespace_id: namespace.id,
      collection_id: collection?.id,
      ...item,
    });
    storedItems.push(created);
    console.log(`  [${item.source_agent}] Stored: "${item.title}"`);
  }
  console.log(`\n  Total: ${storedItems.length} knowledge items stored.`);

  // ── Step 5: Semantic Search ──────────────────────────

  log("Step 5", 'Agent searching: "How do we handle rate limiting for payments?"');
  const semanticResults = await api("POST", "/api/v1/search/semantic", {
    query: "How do we handle rate limiting for payments?",
    namespace: namespace.id,
    limit: 3,
  });
  console.log(`  Found ${semanticResults.count} results (semantic):`);
  for (const r of semanticResults.results) {
    console.log(`    - [score=${r.score}] ${r.title}`);
    console.log(`      Tags: ${r.tags.join(", ")}`);
    console.log(`      Agent: ${r.source_agent}`);
  }

  // ── Step 6: Full-Text Search ─────────────────────────

  log("Step 6", 'Agent searching full-text: "connection pool outage"');
  const fulltextResults = await api("POST", "/api/v1/search/structured", {
    query: "connection pool outage",
    namespace: namespace.id,
    limit: 3,
  });
  console.log(`  Found ${fulltextResults.count} results (full-text):`);
  for (const r of fulltextResults.results) {
    console.log(`    - [score=${r.score}] ${r.title}`);
  }

  // ── Step 7: Hybrid Search ────────────────────────────

  log("Step 7", 'Agent searching hybrid: "kubernetes resource allocation best practices"');
  const hybridResults = await api("POST", "/api/v1/search", {
    query: "kubernetes resource allocation best practices",
    namespace: namespace.id,
    limit: 5,
  });
  console.log(`  Found ${hybridResults.count} results (hybrid):`);
  for (const r of hybridResults.results) {
    console.log(`    - [score=${r.score}] [${r.match_type}] ${r.title}`);
  }

  // ── Step 8: Tag-Filtered Search ──────────────────────

  log("Step 8", 'Agent searching with tag filter: "security" tag');
  const tagResults = await api("POST", "/api/v1/search", {
    query: "authentication and security",
    namespace: namespace.id,
    tags: ["security"],
    limit: 5,
  });
  console.log(`  Found ${tagResults.count} results with tag "security":`);
  for (const r of tagResults.results) {
    console.log(`    - [score=${r.score}] ${r.title}`);
    console.log(`      Tags: ${r.tags.join(", ")}`);
  }

  // ── Step 9: List by Agent ────────────────────────────

  log("Step 9", "Listing all knowledge from 'architecture-bot'...");
  const agentItems = await api("GET", `/api/v1/knowledge?source_agent=architecture-bot&namespace_id=${namespace.id}`);
  console.log(`  architecture-bot has contributed ${agentItems.total} knowledge items:`);
  for (const item of agentItems.data) {
    console.log(`    - ${item.title} [${item.tags.join(", ")}]`);
  }

  // ── Done ─────────────────────────────────────────────

  console.log(`\n${"═".repeat(60)}`);
  console.log("  Demo completed successfully!");
  console.log(`${"═".repeat(60)}\n`);
}

runDemo().catch((err) => {
  console.error("\nDemo failed:", err.message);
  process.exit(1);
});
