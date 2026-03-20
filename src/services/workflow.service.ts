import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "../db/connection.js";
import {
  workflowTemplates,
  workflowSteps,
  workflowStepEdges,
  workflowExecutions,
  workflowStepExecutions,
} from "../db/schema.js";
import type {
  CreateWorkflowInput,
  UpdateWorkflowInput,
  ExecuteWorkflowInput,
  CompleteStepInput,
  WorkflowDetail,
  ExecutionDetail,
  PaginationParams,
} from "../types/index.js";

export class WorkflowService {
  // ── Template CRUD ─────────────────────────────────────────

  async createWorkflow(input: CreateWorkflowInput): Promise<WorkflowDetail> {
    const stepKeyToId = new Map<string, string>();

    const [template] = await db
      .insert(workflowTemplates)
      .values({
        namespaceId: input.namespace_id,
        name: input.name,
        description: input.description,
        triggerConditions: input.trigger_conditions,
        metadata: input.metadata ?? {},
        createdBy: input.created_by,
      })
      .returning();

    const templateId = template!.id;

    const insertedSteps = [];
    for (const step of input.steps) {
      const [inserted] = await db
        .insert(workflowSteps)
        .values({
          templateId,
          stepKey: step.step_key,
          name: step.name,
          description: step.description,
          stepType: step.step_type,
          config: step.config ?? {},
          knowledgeItemId: step.knowledge_item_id,
          position: step.position,
          metadata: step.metadata ?? {},
        })
        .returning();
      stepKeyToId.set(step.step_key, inserted!.id);
      insertedSteps.push(inserted!);
    }

    const insertedEdges = [];
    for (const edge of input.edges) {
      const fromId = stepKeyToId.get(edge.from_step_key);
      const toId = stepKeyToId.get(edge.to_step_key);
      if (!fromId || !toId) {
        throw new Error(
          `Invalid edge: step_key "${edge.from_step_key}" or "${edge.to_step_key}" not found`,
        );
      }

      const [inserted] = await db
        .insert(workflowStepEdges)
        .values({
          templateId,
          fromStepId: fromId,
          toStepId: toId,
          condition: edge.condition,
          label: edge.label,
        })
        .returning();
      insertedEdges.push(inserted!);
    }

    this.validateDAG(insertedSteps, insertedEdges);

    return this.getWorkflowById(templateId) as Promise<WorkflowDetail>;
  }

  async getWorkflowById(id: string): Promise<WorkflowDetail | null> {
    const [template] = await db
      .select()
      .from(workflowTemplates)
      .where(eq(workflowTemplates.id, id))
      .limit(1);

    if (!template) return null;

    const steps = await db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.templateId, id));

    const edges = await db
      .select()
      .from(workflowStepEdges)
      .where(eq(workflowStepEdges.templateId, id));

    return {
      id: template.id,
      namespace_id: template.namespaceId,
      name: template.name,
      description: template.description,
      version: template.version,
      status: template.status,
      trigger_conditions: template.triggerConditions as Record<string, unknown> | null,
      metadata: (template.metadata as Record<string, unknown>) ?? {},
      created_by: template.createdBy,
      created_at: template.createdAt,
      updated_at: template.updatedAt,
      steps: steps.map((s) => ({
        id: s.id,
        step_key: s.stepKey,
        name: s.name,
        description: s.description,
        step_type: s.stepType,
        config: (s.config as Record<string, unknown>) ?? {},
        knowledge_item_id: s.knowledgeItemId,
        position: s.position as { x: number; y: number } | null,
        metadata: (s.metadata as Record<string, unknown>) ?? {},
      })),
      edges: edges.map((e) => ({
        id: e.id,
        from_step_id: e.fromStepId,
        to_step_id: e.toStepId,
        condition: e.condition as Record<string, unknown> | null,
        label: e.label,
      })),
    };
  }

  async updateWorkflow(id: string, input: UpdateWorkflowInput): Promise<WorkflowDetail | null> {
    const existing = await this.getWorkflowById(id);
    if (!existing) return null;

    const newVersion = input.steps || input.edges ? existing.version + 1 : existing.version;

    await db
      .update(workflowTemplates)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.trigger_conditions !== undefined && { triggerConditions: input.trigger_conditions }),
        ...(input.metadata !== undefined && { metadata: input.metadata }),
        version: newVersion,
        updatedAt: new Date(),
      })
      .where(eq(workflowTemplates.id, id));

    if (input.steps && input.edges) {
      await db.delete(workflowStepEdges).where(eq(workflowStepEdges.templateId, id));
      await db.delete(workflowSteps).where(eq(workflowSteps.templateId, id));

      const stepKeyToId = new Map<string, string>();
      const insertedSteps = [];

      for (const step of input.steps) {
        const [inserted] = await db
          .insert(workflowSteps)
          .values({
            templateId: id,
            stepKey: step.step_key,
            name: step.name,
            description: step.description,
            stepType: step.step_type,
            config: step.config ?? {},
            knowledgeItemId: step.knowledge_item_id,
            position: step.position,
            metadata: step.metadata ?? {},
          })
          .returning();
        stepKeyToId.set(step.step_key, inserted!.id);
        insertedSteps.push(inserted!);
      }

      const insertedEdges = [];
      for (const edge of input.edges) {
        const fromId = stepKeyToId.get(edge.from_step_key);
        const toId = stepKeyToId.get(edge.to_step_key);
        if (!fromId || !toId) {
          throw new Error(
            `Invalid edge: step_key "${edge.from_step_key}" or "${edge.to_step_key}" not found`,
          );
        }

        const [inserted] = await db
          .insert(workflowStepEdges)
          .values({
            templateId: id,
            fromStepId: fromId,
            toStepId: toId,
            condition: edge.condition,
            label: edge.label,
          })
          .returning();
        insertedEdges.push(inserted!);
      }

      this.validateDAG(insertedSteps, insertedEdges);
    }

    return this.getWorkflowById(id);
  }

  async listWorkflows(filters: {
    namespace_id?: string;
    status?: string;
    pagination: PaginationParams;
  }) {
    const conditions = [];

    if (filters.namespace_id) {
      conditions.push(eq(workflowTemplates.namespaceId, filters.namespace_id));
    }
    if (filters.status) {
      conditions.push(eq(workflowTemplates.status, filters.status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(workflowTemplates)
        .where(whereClause)
        .orderBy(desc(workflowTemplates.updatedAt))
        .limit(filters.pagination.limit)
        .offset(filters.pagination.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(workflowTemplates)
        .where(whereClause),
    ]);

    return {
      data,
      total: countResult[0]?.count ?? 0,
      limit: filters.pagination.limit,
      offset: filters.pagination.offset,
    };
  }

  // ── Execution Engine ──────────────────────────────────────

  async executeWorkflow(
    templateId: string,
    input: ExecuteWorkflowInput,
  ): Promise<ExecutionDetail> {
    const template = await this.getWorkflowById(templateId);
    if (!template) throw new Error("Workflow template not found");
    if (template.status !== "active") {
      throw new Error(`Workflow template is "${template.status}", must be "active" to execute`);
    }

    const [execution] = await db
      .insert(workflowExecutions)
      .values({
        templateId,
        namespaceId: template.namespace_id,
        status: "running",
        initiatedBy: input.initiated_by,
        context: input.context ?? {},
      })
      .returning();

    const sortedSteps = this.topoSortSteps(template.steps, template.edges);
    const entryStepIds = this.findEntrySteps(template.steps, template.edges);

    for (const step of sortedSteps) {
      const isEntry = entryStepIds.has(step.id);
      await db.insert(workflowStepExecutions).values({
        executionId: execution!.id,
        stepId: step.id,
        status: isEntry ? "running" : "pending",
        startedAt: isEntry ? new Date() : undefined,
      });
    }

    return this.getExecutionById(execution!.id) as Promise<ExecutionDetail>;
  }

  async getExecutionById(id: string): Promise<ExecutionDetail | null> {
    const [execution] = await db
      .select()
      .from(workflowExecutions)
      .where(eq(workflowExecutions.id, id))
      .limit(1);

    if (!execution) return null;

    const stepExecs = await db
      .select({
        id: workflowStepExecutions.id,
        step_id: workflowStepExecutions.stepId,
        status: workflowStepExecutions.status,
        input: workflowStepExecutions.input,
        output: workflowStepExecutions.output,
        error: workflowStepExecutions.error,
        started_at: workflowStepExecutions.startedAt,
        completed_at: workflowStepExecutions.completedAt,
        step_key: workflowSteps.stepKey,
        step_name: workflowSteps.name,
      })
      .from(workflowStepExecutions)
      .leftJoin(workflowSteps, eq(workflowStepExecutions.stepId, workflowSteps.id))
      .where(eq(workflowStepExecutions.executionId, id));

    return {
      id: execution.id,
      template_id: execution.templateId,
      namespace_id: execution.namespaceId,
      status: execution.status,
      initiated_by: execution.initiatedBy,
      context: (execution.context as Record<string, unknown>) ?? {},
      result: execution.result as Record<string, unknown> | null,
      started_at: execution.startedAt,
      completed_at: execution.completedAt,
      step_executions: stepExecs.map((se) => ({
        id: se.id,
        step_id: se.step_id,
        step_key: se.step_key ?? undefined,
        step_name: se.step_name ?? undefined,
        status: se.status,
        input: se.input as Record<string, unknown> | null,
        output: se.output as Record<string, unknown> | null,
        error: se.error,
        started_at: se.started_at,
        completed_at: se.completed_at,
      })),
    };
  }

  async listExecutions(filters: {
    template_id?: string;
    namespace_id?: string;
    status?: string;
    pagination: PaginationParams;
  }) {
    const conditions = [];

    if (filters.template_id) {
      conditions.push(eq(workflowExecutions.templateId, filters.template_id));
    }
    if (filters.namespace_id) {
      conditions.push(eq(workflowExecutions.namespaceId, filters.namespace_id));
    }
    if (filters.status) {
      conditions.push(eq(workflowExecutions.status, filters.status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(workflowExecutions)
        .where(whereClause)
        .orderBy(desc(workflowExecutions.startedAt))
        .limit(filters.pagination.limit)
        .offset(filters.pagination.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(workflowExecutions)
        .where(whereClause),
    ]);

    return {
      data,
      total: countResult[0]?.count ?? 0,
      limit: filters.pagination.limit,
      offset: filters.pagination.offset,
    };
  }

  async completeStep(
    executionId: string,
    stepId: string,
    input: CompleteStepInput,
  ): Promise<ExecutionDetail> {
    const execution = await this.getExecutionById(executionId);
    if (!execution) throw new Error("Execution not found");
    if (execution.status !== "running") {
      throw new Error(`Execution is "${execution.status}", cannot complete steps`);
    }

    const status = input.status ?? "completed";
    const now = new Date();

    await db
      .update(workflowStepExecutions)
      .set({
        status,
        output: input.output,
        error: input.error,
        completedAt: now,
      })
      .where(
        and(
          eq(workflowStepExecutions.executionId, executionId),
          eq(workflowStepExecutions.stepId, stepId),
        ),
      );

    if (status === "failed") {
      await db
        .update(workflowExecutions)
        .set({ status: "failed", completedAt: now })
        .where(eq(workflowExecutions.id, executionId));
      return this.getExecutionById(executionId) as Promise<ExecutionDetail>;
    }

    if (status === "completed" || status === "skipped") {
      const template = await this.getWorkflowById(execution.template_id);
      if (!template) throw new Error("Template not found");

      const edges = await db
        .select()
        .from(workflowStepEdges)
        .where(
          and(
            eq(workflowStepEdges.templateId, execution.template_id),
            eq(workflowStepEdges.fromStepId, stepId),
          ),
        );

      for (const edge of edges) {
        const allIncoming = await db
          .select()
          .from(workflowStepEdges)
          .where(
            and(
              eq(workflowStepEdges.templateId, execution.template_id),
              eq(workflowStepEdges.toStepId, edge.toStepId),
            ),
          );

        const allPredecessorsComplete = await this.allPredecessorsComplete(
          executionId,
          allIncoming.map((e) => e.fromStepId),
        );

        if (allPredecessorsComplete) {
          await db
            .update(workflowStepExecutions)
            .set({ status: "running", startedAt: now })
            .where(
              and(
                eq(workflowStepExecutions.executionId, executionId),
                eq(workflowStepExecutions.stepId, edge.toStepId),
                eq(workflowStepExecutions.status, "pending"),
              ),
            );
        }
      }

      const updatedExec = await this.getExecutionById(executionId);
      const allDone = updatedExec!.step_executions.every(
        (se) => se.status === "completed" || se.status === "skipped" || se.status === "failed",
      );

      if (allDone) {
        const hasFailed = updatedExec!.step_executions.some((se) => se.status === "failed");
        await db
          .update(workflowExecutions)
          .set({
            status: hasFailed ? "failed" : "completed",
            completedAt: now,
          })
          .where(eq(workflowExecutions.id, executionId));
      }
    }

    return this.getExecutionById(executionId) as Promise<ExecutionDetail>;
  }

  async cancelExecution(executionId: string): Promise<ExecutionDetail> {
    const execution = await this.getExecutionById(executionId);
    if (!execution) throw new Error("Execution not found");

    const now = new Date();
    await db
      .update(workflowExecutions)
      .set({ status: "cancelled", completedAt: now })
      .where(eq(workflowExecutions.id, executionId));

    await db
      .update(workflowStepExecutions)
      .set({ status: "skipped", completedAt: now })
      .where(
        and(
          eq(workflowStepExecutions.executionId, executionId),
          sql`${workflowStepExecutions.status} IN ('pending', 'running')`,
        ),
      );

    return this.getExecutionById(executionId) as Promise<ExecutionDetail>;
  }

  // ── DAG Validation ────────────────────────────────────────

  private validateDAG(
    steps: { id: string }[],
    edges: { fromStepId: string; toStepId: string }[],
  ): void {
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const step of steps) {
      inDegree.set(step.id, 0);
      adjacency.set(step.id, []);
    }

    for (const edge of edges) {
      adjacency.get(edge.fromStepId)?.push(edge.toStepId);
      inDegree.set(edge.toStepId, (inDegree.get(edge.toStepId) ?? 0) + 1);
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    let visited = 0;
    while (queue.length > 0) {
      const node = queue.shift()!;
      visited++;
      for (const neighbor of adjacency.get(node) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }

    if (visited !== steps.length) {
      throw new Error("Workflow contains a cycle: steps do not form a valid DAG");
    }
  }

  private topoSortSteps(
    steps: { id: string }[],
    edges: { from_step_id: string; to_step_id: string }[],
  ) {
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();
    const stepMap = new Map(steps.map((s) => [s.id, s]));

    for (const step of steps) {
      inDegree.set(step.id, 0);
      adjacency.set(step.id, []);
    }

    for (const edge of edges) {
      adjacency.get(edge.from_step_id)?.push(edge.to_step_id);
      inDegree.set(edge.to_step_id, (inDegree.get(edge.to_step_id) ?? 0) + 1);
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const sorted: typeof steps = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      sorted.push(stepMap.get(id)!);
      for (const neighbor of adjacency.get(id) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }

    return sorted;
  }

  private findEntrySteps(
    steps: { id: string }[],
    edges: { from_step_id: string; to_step_id: string }[],
  ): Set<string> {
    const hasIncoming = new Set(edges.map((e) => e.to_step_id));
    return new Set(steps.filter((s) => !hasIncoming.has(s.id)).map((s) => s.id));
  }

  private async allPredecessorsComplete(
    executionId: string,
    predecessorStepIds: string[],
  ): Promise<boolean> {
    if (predecessorStepIds.length === 0) return true;

    const result = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM workflow_step_executions
      WHERE execution_id = ${executionId}
        AND step_id = ANY(${predecessorStepIds}::uuid[])
        AND status NOT IN ('completed', 'skipped')
    `);

    return (result.rows[0]?.count ?? 1) === 0;
  }
}
