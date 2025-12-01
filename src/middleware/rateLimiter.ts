import rateLimit from 'express-rate-limit';
import { RequestHandler } from 'express';

// Disable rate limiting via environment variable
const RATE_LIMIT_DISABLED = process.env.RATE_LIMIT_DISABLED === 'true';

// No-op middleware when rate limiting is disabled
const noopMiddleware: RequestHandler = (_req, _res, next) => next();

/**
 * Rate limiter for general API endpoints
 * Allows 100 requests per 15 minutes per IP
 */
export const apiLimiter: RequestHandler = RATE_LIMIT_DISABLED ? noopMiddleware : rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too many requests from this IP, please try again later',
      code: 'RATE_LIMIT_EXCEEDED'
    });
  }
});

/**
 * Rate limiter for data endpoints (historical data queries)
 * Allows 500 requests per 15 minutes per IP (charting apps need many requests)
 */
export const strictLimiter: RequestHandler = RATE_LIMIT_DISABLED ? noopMiddleware : rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Limit each IP to 500 requests per windowMs
  message: {
    error: 'Too many data requests from this IP, please try again later',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Count all requests, even successful ones
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too many data requests from this IP, please try again later',
      code: 'RATE_LIMIT_EXCEEDED'
    });
  }
});

/**
 * Very permissive rate limiter for health/metrics endpoints
 * Allows 300 requests per 15 minutes per IP
 */
export const healthLimiter: RequestHandler = RATE_LIMIT_DISABLED ? noopMiddleware : rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Limit each IP to 300 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true // Don't count failed requests
});
