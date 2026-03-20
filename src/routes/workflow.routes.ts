import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WorkflowService } from "../services/workflow.service.js";
import { httpError } from "../middleware/error-handler.js";

const stepSchema = z.object({
  step_key: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  step_type: z.enum(["manual", "automated", "approval", "notification"]),
  config: z.record(z.unknown()).optional(),
  knowledge_item_id: z.string().uuid().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const edgeSchema = z.object({
  from_step_key: z.string().min(1),
  to_step_key: z.string().min(1),
  condition: z.record(z.unknown()).optional(),
  label: z.string().max(255).optional(),
});

const createWorkflowSchema = z.object({
  namespace_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  trigger_conditions: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  created_by: z.string().max(255).optional(),
  steps: z.array(stepSchema).min(1),
  edges: z.array(edgeSchema).default([]),
});

const updateWorkflowSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  trigger_conditions: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  steps: z.array(stepSchema).optional(),
  edges: z.array(edgeSchema).optional(),
});

const listWorkflowsQuerySchema = z.object({
  namespace_id: z.string().uuid().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

const executeSchema = z.object({
  initiated_by: z.string().max(255).optional(),
  context: z.record(z.unknown()).optional(),
});

const completeStepSchema = z.object({
  output: z.record(z.unknown()).optional(),
  error: z.string().optional(),
  status: z.enum(["completed", "failed", "skipped"]).default("completed"),
});

const listExecutionsQuerySchema = z.object({
  template_id: z.string().uuid().optional(),
  namespace_id: z.string().uuid().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

export function workflowRoutes(workflowService: WorkflowService) {
  return async function (app: FastifyInstance) {
    app.post("/api/v1/workflows", async (req, reply) => {
      const body = createWorkflowSchema.parse(req.body);
      try {
        const workflow = await workflowService.createWorkflow(body);
        reply.code(201).send(workflow);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Invalid workflow";
        if (message.includes("cycle") || message.includes("Invalid edge")) {
          throw httpError(400, message);
        }
        throw err;
      }
    });

    app.get("/api/v1/workflows", async (req) => {
      const query = listWorkflowsQuerySchema.parse(req.query);
      return workflowService.listWorkflows({
        namespace_id: query.namespace_id,
        status: query.status,
        pagination: { limit: query.limit, offset: query.offset },
      });
    });

    app.get("/api/v1/workflows/:id", async (req) => {
      const { id } = req.params as { id: string };
      const workflow = await workflowService.getWorkflowById(id);
      if (!workflow) throw httpError(404, "Workflow template not found");
      return workflow;
    });

    app.put("/api/v1/workflows/:id", async (req) => {
      const { id } = req.params as { id: string };
      const body = updateWorkflowSchema.parse(req.body);
      try {
        const workflow = await workflowService.updateWorkflow(id, body);
        if (!workflow) throw httpError(404, "Workflow template not found");
        return workflow;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Invalid workflow";
        if (message.includes("cycle") || message.includes("Invalid edge")) {
          throw httpError(400, message);
        }
        throw err;
      }
    });

    app.post("/api/v1/workflows/:id/execute", async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = executeSchema.parse(req.body);
      try {
        const execution = await workflowService.executeWorkflow(id, body);
        reply.code(201).send(execution);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Execution failed";
        if (message.includes("not found")) throw httpError(404, message);
        if (message.includes("must be")) throw httpError(400, message);
        throw err;
      }
    });

    app.get("/api/v1/workflows/executions", async (req) => {
      const query = listExecutionsQuerySchema.parse(req.query);
      return workflowService.listExecutions({
        template_id: query.template_id,
        namespace_id: query.namespace_id,
        status: query.status,
        pagination: { limit: query.limit, offset: query.offset },
      });
    });

    app.get("/api/v1/workflows/executions/:id", async (req) => {
      const { id } = req.params as { id: string };
      const execution = await workflowService.getExecutionById(id);
      if (!execution) throw httpError(404, "Execution not found");
      return execution;
    });

    app.post("/api/v1/workflows/executions/:id/steps/:stepId/complete", async (req) => {
      const { id, stepId } = req.params as { id: string; stepId: string };
      const body = completeStepSchema.parse(req.body);
      try {
        return await workflowService.completeStep(id, stepId, body);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Step completion failed";
        if (message.includes("not found")) throw httpError(404, message);
        if (message.includes("cannot")) throw httpError(400, message);
        throw err;
      }
    });

    app.post("/api/v1/workflows/executions/:id/cancel", async (req) => {
      const { id } = req.params as { id: string };
      try {
        return await workflowService.cancelExecution(id);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Cancellation failed";
        if (message.includes("not found")) throw httpError(404, message);
        throw err;
      }
    });
  };
}
