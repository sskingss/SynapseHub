import type { FastifyInstance } from "fastify";
import { pool } from "../db/connection.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "0.1.0",
  }));

  app.get("/health/ready", async (_req, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ready", database: "connected" };
    } catch (err) {
      reply.code(503).send({
        status: "not_ready",
        database: "disconnected",
        error: (err as Error).message,
      });
    }
  });
}
