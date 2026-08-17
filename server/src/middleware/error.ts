import type { Request, Response, NextFunction } from 'express';

export interface ApiErrorPayload {
  code: string;
  message: string;
  retryable?: boolean;
  retryAfter?: number;
}

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly retryAfter?: number;

  constructor(status: number, code: string, message: string, options?: { retryable?: boolean; retryAfter?: number }) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.retryAfter = options?.retryAfter;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function errorHandler(
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    const payload: { error: ApiErrorPayload } = {
      error: {
        code: err.code,
        message: err.message,
        retryable: err.retryable,
        retryAfter: err.retryAfter,
      },
    };
    if (err.retryAfter) {
      res.setHeader('Retry-After', String(err.retryAfter));
    }
    res.status(err.status).json(payload);
    return;
  }

  // Fallback for unhandled unexpected internal errors (never leak stack or SQL in production)
  console.error('[server error]', err);
  res.status(500).json({
    error: {
      code: 'internal_server_error',
      message: 'An unexpected internal error occurred.',
      retryable: true,
    },
  });
}
