import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { KnowledgeService } from "../services/knowledge.service.js";
import type { StorageProvider } from "../types/index.js";
import { httpError } from "../middleware/error-handler.js";

export function fileRoutes(knowledgeService: KnowledgeService, storageProvider: StorageProvider) {
  return async function (app: FastifyInstance) {
    app.post("/api/v1/files/upload", async (req, reply) => {
      const data = await req.file();
      if (!data) throw httpError(400, "No file provided");

      const buffer = await data.toBuffer();
      const ext = data.filename.split(".").pop() ?? "bin";
      const storageKey = `uploads/${randomUUID()}.${ext}`;

      await storageProvider.upload(storageKey, buffer, data.mimetype);

      const knowledgeItemId = (data.fields.knowledge_item_id as any)?.value as string | undefined;
      const uploadedBy = (data.fields.uploaded_by as any)?.value as string | undefined;

      const attachment = await knowledgeService.createAttachment({
        knowledgeItemId,
        filename: data.filename,
        mimeType: data.mimetype,
        sizeBytes: buffer.length,
        storageKey,
        uploadedBy,
      });

      reply.code(201).send(attachment);
    });

    app.get("/api/v1/files/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const attachment = await knowledgeService.getAttachmentById(id);
      if (!attachment) throw httpError(404, "File not found");

      const { body, contentType } = await storageProvider.download(attachment.storageKey);

      reply
        .header("Content-Type", contentType ?? attachment.mimeType ?? "application/octet-stream")
        .header("Content-Disposition", `inline; filename="${attachment.filename}"`)
        .send(body);
    });

    app.delete("/api/v1/files/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const storageKey = await knowledgeService.deleteAttachment(id);
      if (!storageKey) throw httpError(404, "File not found");

      await storageProvider.delete(storageKey);
      reply.code(204).send();
    });
  };
}
