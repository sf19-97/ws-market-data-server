import { Request, Response, NextFunction } from 'express';
import { Logger } from 'pino';
import { ApiError } from './validation.js';
import { sanitizeObject, sanitizeHeaders } from '../utils/logger.js';

/**
 * Global error handling middleware
 * Catches all errors and returns consistent JSON responses
 */
export function errorHandler(logger: Logger) {
  return (err: Error, req: Request, res: Response, _next: NextFunction): void => {
    // Handle known API errors
    if (err instanceof ApiError) {
      logger.warn({
        statusCode: err.statusCode,
        code: err.code,
        message: err.message,
        path: req.path,
        method: req.method
      }, 'API error');

      res.status(err.statusCode).json({
        error: err.message,
        code: err.code
      });
      return;
    }

    // Handle database errors
    if (err.name === 'PostgresError' || err.message?.includes('database')) {
      logger.error({
        err,
        path: req.path,
        method: req.method
      }, 'Database error');

      res.status(503).json({
        error: 'Database service unavailable',
        code: 'DATABASE_ERROR'
      });
      return;
    }

    // Handle validation errors from other sources
    if (err.name === 'ValidationError') {
      logger.warn({
        err,
        path: req.path,
        method: req.method
      }, 'Validation error');

      res.status(400).json({
        error: err.message,
        code: 'VALIDATION_ERROR'
      });
      return;
    }

    // Log unexpected errors with full details (sanitized)
    logger.error({
      err,
      path: req.path,
      method: req.method,
      query: sanitizeObject(req.query),
      body: sanitizeObject(req.body),
      headers: sanitizeHeaders(req.headers)
    }, 'Unhandled error');

    // Don't leak internal error details in production
    const isDevelopment = process.env.NODE_ENV !== 'production';
    res.status(500).json({
      error: isDevelopment ? err.message : 'Internal server error',
      code: 'INTERNAL_ERROR',
      ...(isDevelopment && { stack: err.stack })
    });
  };
}

/**
 * 404 Not Found handler
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'Endpoint not found',
    code: 'NOT_FOUND',
    path: req.path
  });
}

/**
 * Async route handler wrapper - catches promise rejections
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
