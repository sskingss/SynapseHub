import { createHash } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "../db/connection.js";
import { apiKeys } from "../db/schema.js";
import { config } from "../config.js";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Extracts the API key from the Authorization header (Bearer token)
 * or X-API-Key header.
 */
function extractApiKey(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  const apiKeyHeader = request.headers["x-api-key"];
  if (typeof apiKeyHeader === "string") {
    return apiKeyHeader;
  }
  return null;
}

/**
 * Fastify preHandler hook that validates API keys.
 * The master key bypasses DB lookup and grants full access.
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const key = extractApiKey(request);

  if (!key) {
    reply.code(401).send({ error: "Missing API key. Provide via Authorization: Bearer <key> or X-API-Key header." });
    return;
  }

  // Master key bypass for admin operations
  if (key === config.MASTER_API_KEY) {
    (request as any).agentName = "_master";
    (request as any).namespaceId = null;
    return;
  }

  const prefix = key.slice(0, 8);
  const hash = hashKey(key);

  const [record] = await db
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.keyPrefix, prefix),
        eq(apiKeys.keyHash, hash),
        isNull(apiKeys.revokedAt),
      ),
    )
    .limit(1);

  if (!record) {
    reply.code(401).send({ error: "Invalid or revoked API key." });
    return;
  }

  if (record.expiresAt && record.expiresAt < new Date()) {
    reply.code(401).send({ error: "API key has expired." });
    return;
  }

  (request as any).agentName = record.agentName;
  (request as any).namespaceId = record.namespaceId;
}

// ── Utility for creating API keys ───────────────────────────

export function generateApiKeyRecord(rawKey: string) {
  return {
    keyPrefix: rawKey.slice(0, 8),
    keyHash: hashKey(rawKey),
  };
}
