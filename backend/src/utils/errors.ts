/**
 * Custom error classes for better error handling
 */

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public isOperational: boolean = true,
    /**
     * A stable, machine-readable discriminator, surfaced as `code` in the error
     * envelope.
     *
     * Exists because a client that has to branch on behaviour cannot branch on
     * `message`: the frontend was matching `/x-register-token/i` against prose to
     * decide whether a 401 meant "this device was revoked" (clear the device
     * token, go to pairing) or "your session expired" (go to login). Rewording
     * the message would have silently broken the revoked-device path, and a
     * revoked till would have gone on retrying forever — the exact failure that
     * enrolment exists to prevent.
     *
     * Only set it where a client genuinely needs to distinguish outcomes that
     * share a status code. Prose stays in `message`.
     */
    public code?: string
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
  constructor(message: string = 'Authentication failed', code?: string) {
    super(message, 401, true, code);
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
  constructor(message: string, code?: string) {
    super(message, 409, true, code);
  }
}

/**
 * The request was well-formed and the resource it names is real, but the
 * operation is refused because of a business rule rather than a data
 * conflict — e.g. an org's register count is already at its `max_registers`
 * cap. 422 rather than 409: nothing else would come to conflict with, and
 * rather than 400: the request body itself was valid.
 */
export class UnprocessableEntityError extends AppError {
  constructor(message: string) {
    super(message, 422);
  }
}

/**
 * A dependency this request needed is unavailable or misconfigured.
 *
 * 502 rather than 500: the request was fine and the server is fine, something
 * downstream is not. Retrying may work; reporting it as a server fault sends
 * whoever reads the logs looking in the wrong place.
 */
export class ServiceUnavailableError extends AppError {
  constructor(message: string) {
    super(message, 502);
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
