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

  // ── Step 10: Knowledge Graph — Create Relations ─────

  log("Step 10", "Building knowledge graph relations...");

  const rateLimitItem = storedItems[0]!;
  const authItem = storedItems[1]!;
  const dbMigrationItem = storedItems[2]!;
  const incidentItem = storedItems[3]!;
  const apiVersioningItem = storedItems[4]!;
  const k8sItem = storedItems[5]!;
  const frontendItem = storedItems[6]!;

  const relations = [
    { source_id: incidentItem.id, target_id: rateLimitItem.id, relation_type: "references", created_by: "incident-bot" },
    { source_id: rateLimitItem.id, target_id: authItem.id, relation_type: "depends_on", created_by: "architecture-bot" },
    { source_id: apiVersioningItem.id, target_id: rateLimitItem.id, relation_type: "references", created_by: "architecture-bot" },
    { source_id: k8sItem.id, target_id: rateLimitItem.id, relation_type: "references", created_by: "devops-bot" },
    { source_id: dbMigrationItem.id, target_id: apiVersioningItem.id, relation_type: "precedes", created_by: "devops-bot" },
    { source_id: frontendItem.id, target_id: authItem.id, relation_type: "depends_on", created_by: "frontend-agent" },
  ];

  for (const rel of relations) {
    await api("POST", "/api/v1/graph/relations", rel);
    console.log(`  Created: ${rel.relation_type} (${rel.source_id.slice(0, 8)}... -> ${rel.target_id.slice(0, 8)}...)`);
  }

  // ── Step 11: Knowledge Graph — Query Neighbors ─────

  log("Step 11", `Querying neighbors of "Rate Limiting Strategy"...`);
  const neighbors = await api("GET", `/api/v1/graph/neighbors/${rateLimitItem.id}?depth=1`);
  console.log(`  Found ${neighbors.nodes.length} neighbors, ${neighbors.edges.length} edges:`);
  for (const node of neighbors.nodes) {
    console.log(`    - ${node.title} [${node.content_type}]`);
  }

  // ── Step 12: Knowledge Graph — Find Path ───────────

  log("Step 12", `Finding path from "Frontend Error Tracking" to "Rate Limiting"...`);
  try {
    const path = await api("POST", "/api/v1/graph/path", {
      source_id: frontendItem.id,
      target_id: rateLimitItem.id,
      max_depth: 5,
    });
    console.log(`  Path found (depth ${path.depth}): ${path.path.map((id: string) => id.slice(0, 8)).join(" -> ")}`);
    for (const edge of path.edges) {
      console.log(`    Edge: ${edge.relation_type} (${edge.source_id.slice(0, 8)}... -> ${edge.target_id.slice(0, 8)}...)`);
    }
  } catch {
    console.log("  No path found between these nodes.");
  }

  // ── Step 13: Knowledge Graph — Subgraph ────────────

  log("Step 13", `Extracting subgraph around "Rate Limiting Strategy" (depth=2)...`);
  const subgraph = await api("POST", "/api/v1/graph/subgraph", {
    node_id: rateLimitItem.id,
    depth: 2,
    limit: 50,
  });
  console.log(`  Subgraph: ${subgraph.nodes.length} nodes, ${subgraph.edges.length} edges`);
  for (const node of subgraph.nodes) {
    console.log(`    Node: ${node.title}`);
  }

  // ── Step 14: Graph-Aware Search ────────────────────

  log("Step 14", 'Graph-aware search: "rate limiting and authentication"...');
  const graphResults = await api("POST", "/api/v1/search/graph", {
    query: "rate limiting and authentication",
    namespace: namespace.id,
    include_relations: true,
    relation_depth: 1,
    limit: 3,
  });
  console.log(`  Found ${graphResults.count} results with graph relations:`);
  for (const r of graphResults.results) {
    console.log(`    - [score=${r.score}] ${r.title}`);
    if (r.related_items?.length > 0) {
      console.log(`      Related (${r.related_items.length}):`);
      for (const rel of r.related_items) {
        console.log(`        -> ${rel.item.title} [${rel.relation.relation_type}]`);
      }
    }
  }

  // ── Step 15: Create Workflow Template ──────────────

  log("Step 15", "Creating 'Code Review & Deploy' workflow template...");
  const workflow = await api("POST", "/api/v1/workflows", {
    namespace_id: namespace.id,
    name: "Code Review and Deploy",
    description: "Standard code review, testing, and deployment pipeline",
    created_by: "devops-bot",
    steps: [
      { step_key: "code-review", name: "Code Review", step_type: "approval", description: "Peer code review", knowledge_item_id: dbMigrationItem.id },
      { step_key: "run-tests", name: "Run Tests", step_type: "automated", description: "Execute test suite" },
      { step_key: "security-scan", name: "Security Scan", step_type: "automated", description: "SAST/DAST scanning", knowledge_item_id: authItem.id },
      { step_key: "staging-deploy", name: "Deploy to Staging", step_type: "automated", description: "Deploy to staging environment" },
      { step_key: "prod-approval", name: "Production Approval", step_type: "approval", description: "Approve production deployment" },
      { step_key: "prod-deploy", name: "Deploy to Production", step_type: "automated", description: "Deploy to production", knowledge_item_id: k8sItem.id },
    ],
    edges: [
      { from_step_key: "code-review", to_step_key: "run-tests", label: "approved" },
      { from_step_key: "code-review", to_step_key: "security-scan", label: "approved" },
      { from_step_key: "run-tests", to_step_key: "staging-deploy", label: "tests pass" },
      { from_step_key: "security-scan", to_step_key: "staging-deploy", label: "no vulnerabilities" },
      { from_step_key: "staging-deploy", to_step_key: "prod-approval" },
      { from_step_key: "prod-approval", to_step_key: "prod-deploy", label: "approved" },
    ],
  });
  console.log(`  Created workflow: "${workflow.name}" (v${workflow.version})`);
  console.log(`  Steps: ${workflow.steps.length}, Edges: ${workflow.edges.length}`);

  // ── Step 16: Activate & Execute Workflow ───────────

  log("Step 16", "Activating and executing workflow...");
  await api("PUT", `/api/v1/workflows/${workflow.id}`, { status: "active" });
  console.log("  Workflow activated.");

  const execution = await api("POST", `/api/v1/workflows/${workflow.id}/execute`, {
    initiated_by: "developer-alice",
    context: { pr_number: 1234, branch: "feature/add-caching" },
  });
  console.log(`  Execution started: ${execution.id}`);
  console.log(`  Status: ${execution.status}`);
  console.log(`  Step statuses:`);
  for (const se of execution.step_executions) {
    console.log(`    - ${se.step_name}: ${se.status}`);
  }

  // ── Step 17: Progress Through Workflow ─────────────

  log("Step 17", "Progressing through workflow steps...");
  const codeReviewStep = execution.step_executions.find((se: any) => se.step_key === "code-review");
  if (codeReviewStep) {
    const afterReview = await api(
      "POST",
      `/api/v1/workflows/executions/${execution.id}/steps/${codeReviewStep.step_id}/complete`,
      { output: { reviewer: "bob", approved: true }, status: "completed" },
    );
    console.log("  Code Review completed. Updated statuses:");
    for (const se of afterReview.step_executions) {
      console.log(`    - ${se.step_name}: ${se.status}`);
    }
  }

  // ── Step 18: View Execution Details ────────────────

  log("Step 18", "Viewing execution details...");
  const execDetail = await api("GET", `/api/v1/workflows/executions/${execution.id}`);
  console.log(`  Execution ${execDetail.id}:`);
  console.log(`    Status: ${execDetail.status}`);
  console.log(`    Initiated by: ${execDetail.initiated_by}`);
  console.log(`    Steps:`);
  for (const se of execDetail.step_executions) {
    console.log(`      - ${se.step_name}: ${se.status}${se.output ? ` (output: ${JSON.stringify(se.output)})` : ""}`);
  }

  // ── Step 19: List Workflows & Executions ───────────

  log("Step 19", "Listing workflows and executions...");
  const workflows = await api("GET", `/api/v1/workflows?namespace_id=${namespace.id}`);
  console.log(`  Workflows: ${workflows.total}`);
  for (const wf of workflows.data) {
    console.log(`    - ${wf.name} (v${wf.version}, ${wf.status})`);
  }

  const executions = await api("GET", `/api/v1/workflows/executions?namespace_id=${namespace.id}`);
  console.log(`  Executions: ${executions.total}`);
  for (const ex of executions.data) {
    console.log(`    - ${ex.id.slice(0, 8)}... [${ex.status}] started ${ex.started_at}`);
  }

  // ── Step 20: Pattern Analysis ──────────────────────

  log("Step 20", "Running pattern analysis on the namespace...");
  const patterns = await api("POST", "/api/v1/patterns/analyze", {
    namespace_id: namespace.id,
    pattern_types: ["collaboration", "knowledge_cluster"],
    min_frequency: 1,
  });
  console.log(`  Discovered ${patterns.count} patterns:`);
  for (const p of patterns.patterns) {
    console.log(`    - [${p.pattern_type}] ${p.name} (freq=${p.frequency}, conf=${p.confidence.toFixed(2)})`);
  }

  // ── Step 21: List & Recommend Patterns ─────────────

  log("Step 21", "Listing patterns and getting recommendations...");
  const allPatterns = await api("GET", `/api/v1/patterns?namespace_id=${namespace.id}`);
  console.log(`  Total patterns: ${allPatterns.total}`);

  const recommendations = await api("POST", "/api/v1/patterns/recommend", {
    namespace_id: namespace.id,
    limit: 3,
  });
  console.log(`  Top ${recommendations.count} recommended patterns:`);
  for (const p of recommendations.patterns) {
    console.log(`    - [${p.pattern_type}] ${p.name}`);
  }

  // ── Done ─────────────────────────────────────────────

  console.log(`\n${"═".repeat(60)}`);
  console.log("  Demo completed successfully!");
  console.log("  Features demonstrated:");
  console.log("    - Knowledge CRUD & Search (semantic, full-text, hybrid)");
  console.log("    - Knowledge Graph (relations, neighbors, paths, subgraph)");
  console.log("    - Graph-Aware Search (search with relation expansion)");
  console.log("    - Workflow Templates (DAG creation, validation)");
  console.log("    - Workflow Execution (step progression, status tracking)");
  console.log("    - Pattern Discovery (collaboration, knowledge clusters)");
  console.log(`${"═".repeat(60)}\n`);
}

runDemo().catch((err) => {
  console.error("\nDemo failed:", err.message);
  process.exit(1);
});
