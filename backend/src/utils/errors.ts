/**
 * Custom error classes for better error handling
 */

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401);
  }
}

// Alias for AuthenticationError
export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403);
  }
}

// Alias for AuthorizationError
export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string = 'Database operation failed') {
    super(message, 500);
  }
}

/**
 * Extract a human-readable message from a caught value.
 *
 * `catch` bindings are `unknown` under strict TypeScript, and anything can be thrown,
 * not just `Error`. Use this instead of reaching for `error.message` directly.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unexpected error occurred';
}

/**
 * View a caught value as a loose record.
 *
 * Lets callers read driver- or process-specific fields that are not on `Error` —
 * Postgres `code`/`constraint`, child-process `stdout`/`stderr` — without asserting
 * a shape the runtime never guarantees. Unknown fields read as `undefined`.
 */
export function errorProps(error: unknown): Record<string, unknown> {
  return typeof error === 'object' && error !== null
    ? (error as Record<string, unknown>)
    : {};
}
