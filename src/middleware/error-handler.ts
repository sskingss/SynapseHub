import type { FastifyError, FastifyRequest, FastifyReply } from "fastify";

export function errorHandler(
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  const statusCode = error.statusCode ?? 500;

  if (statusCode >= 500) {
    _request.log.error(error);
  }

  reply.code(statusCode).send({
    error: error.name ?? "InternalServerError",
    message: error.message,
    statusCode,
  });
}

/** Convenience function for creating typed HTTP errors */
export function httpError(statusCode: number, message: string): FastifyError {
  const err = new Error(message) as FastifyError;
  err.statusCode = statusCode;
  return err;
}
