import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for general API endpoints
 * Allows 100 requests per 15 minutes per IP
 */
export const apiLimiter = rateLimit({
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
 * Stricter rate limiter for expensive endpoints (historical data queries)
 * Allows 20 requests per 15 minutes per IP
 */
export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 requests per windowMs
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
export const healthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Limit each IP to 300 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true // Don't count failed requests
});
