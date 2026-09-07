import { getCorrelationId, log } from "@/lib/logger";

/**
 * Typed errors so a caller can tell "you may not" from "your input is wrong"
 * from "someone changed this while you were looking at it".
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super("VALIDATION", message, 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super("UNAUTHORIZED", message, 401);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "Forbidden") {
    super("FORBIDDEN", message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super("NOT_FOUND", message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
  }
}

export class DomainRuleError extends AppError {
  constructor(message: string) {
    super("DOMAIN_RULE", message, 422);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests", readonly retryAfterSec = 60) {
    super("RATE_LIMIT", message, 429);
  }
}

export type ErrorBody = {
  error: string;
  errorDetail: {
    code: string;
    message: string;
    correlationId: string;
    details?: unknown;
  };
};

/**
 * Dual shape for one release (PLAN §32): clients that parse `{ error: string }`
 * keep working; new clients read `errorDetail`.
 */
export function toErrorResponse(error: unknown): { status: number; body: ErrorBody; headers?: Record<string, string> } {
  const correlationId = getCorrelationId() ?? "unknown";
  if (error instanceof AppError) {
    const body: ErrorBody = {
      error: error.message,
      errorDetail: {
        code: error.code,
        message: error.message,
        correlationId,
        details: error.details,
      },
    };
    const headers =
      error instanceof RateLimitError ? { "Retry-After": String(error.retryAfterSec) } : undefined;
    return { status: error.status, body, headers };
  }
  log.error("unhandled error", {
    error: error instanceof Error ? error.message : String(error),
  });
  return {
    status: 500,
    body: {
      error: "Internal error",
      errorDetail: { code: "INTERNAL", message: "Internal error", correlationId },
    },
  };
}
