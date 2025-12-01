import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { MAX_API_DATE_RANGE } from '../utils/constants.js';

/**
 * Custom API Error class for consistent error handling across the application.
 *
 * Extends the standard Error class to include HTTP status code and error code
 * for better client-side error handling and logging.
 *
 * @example
 * ```typescript
 * throw new ApiError(404, 'Symbol not found', 'SYMBOL_NOT_FOUND');
 * // Results in: { error: 'Symbol not found', code: 'SYMBOL_NOT_FOUND' } with 404 status
 * ```
 */
export class ApiError extends Error {
  /**
   * Creates a new ApiError instance.
   *
   * @param statusCode - HTTP status code (e.g., 400, 404, 500)
   * @param message - Human-readable error message
   * @param code - Optional machine-readable error code for client handling
   */
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Validation schemas for API endpoints
 */
export const schemas = {
  // Metadata endpoint validation
  metadata: z.object({
    symbol: z.string()
      .regex(/^[A-Z]{6}$/, 'Symbol must be 6 uppercase letters (e.g., EURUSD)')
      .optional()
  }),

  // Candles endpoint validation
  candles: z.object({
    symbol: z.string()
      .regex(/^[A-Z]{6}$/, 'Symbol must be 6 uppercase letters (e.g., EURUSD)'),
    timeframe: z.enum(['5m', '15m', '1h', '4h', '12h'])
      .default('1h'),
    from: z.string()
      .regex(/^\d+$/, 'from must be a Unix timestamp in seconds')
      .transform(val => parseInt(val)),
    to: z.string()
      .regex(/^\d+$/, 'to must be a Unix timestamp in seconds')
      .transform(val => parseInt(val))
  }).refine(data => data.from < data.to, {
    message: 'from timestamp must be before to timestamp'
  }).refine(data => {
    return (data.to - data.from) <= MAX_API_DATE_RANGE;
  }, {
    message: 'Date range cannot exceed 2 years'
  })
};

/**
 * Express middleware factory for validating request query parameters using Zod schemas.
 *
 * Parses and validates query parameters, automatically transforming types and
 * providing detailed validation error messages. On validation failure, returns
 * a 400 Bad Request response with structured error details.
 *
 * @param schema - Zod schema to validate against
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * app.get('/api/candles',
 *   validateQuery(schemas.candles),
 *   async (req, res) => {
 *     // req.query is now validated and typed
 *     const { symbol, timeframe, from, to } = req.query;
 *   }
 * );
 * ```
 */
export function validateQuery<T extends z.ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const validated = schema.parse(req.query);
      // Replace req.query with validated data (req.query is read-only, so use defineProperty)
      Object.defineProperty(req, 'query', {
        value: validated,
        writable: true,
        enumerable: true,
        configurable: true
      });
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.issues.map((e: z.ZodIssue) => ({
          field: e.path.join('.'),
          message: e.message
        }));

        res.status(400).json({
          error: 'Validation failed',
          details: errors
        });
        return;
      }
      next(error);
    }
  };
}

/**
 * Validate request body against a Zod schema
 */
export function validateBody<T extends z.ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const validated = schema.parse(req.body);
      req.body = validated;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.issues.map((e: z.ZodIssue) => ({
          field: e.path.join('.'),
          message: e.message
        }));

        res.status(400).json({
          error: 'Validation failed',
          details: errors
        });
        return;
      }
      next(error);
    }
  };
}

/**
 * Sanitize symbol format - remove slashes and ensure uppercase
 */
export function sanitizeSymbol(symbol: string): string {
  return symbol.replace(/\//g, '').toUpperCase();
}

/**
 * Validate timeframe is supported
 */
export function isValidTimeframe(timeframe: string): boolean {
  return ['5m', '15m', '1h', '4h', '12h'].includes(timeframe);
}

/**
 * SQL injection prevention - allowlist for table/view names
 * Updated for R2 data lake architecture (candles_5m, candles_15m, etc.)
 */
export const ALLOWED_MATERIALIZED_VIEWS = new Set([
  'candles_5m',
  'candles_15m',
  'candles_1h',
  'candles_4h',
  'candles_12h'
]);

export function validateMaterializedViewName(viewName: string): void {
  if (!ALLOWED_MATERIALIZED_VIEWS.has(viewName)) {
    throw new ApiError(400, 'Invalid timeframe specified', 'INVALID_TIMEFRAME');
  }
}
