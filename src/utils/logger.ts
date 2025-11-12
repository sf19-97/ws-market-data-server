import pino from 'pino';

/**
 * Sensitive field names that should be redacted from logs
 */
const SENSITIVE_FIELDS = new Set([
  'apiKey',
  'api_key',
  'apikey',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'password',
  'passwd',
  'pwd',
  'secret',
  'secretKey',
  'secret_key',
  'privateKey',
  'private_key',
  'authorization',
  'auth',
  'bearer',
  'cookie',
  'session',
  'sessionId',
  'session_id',
  'credentials',
  'accountId',
  'account_id'
]);

/**
 * Sanitizes an object by redacting sensitive fields
 * @param obj - Object to sanitize
 * @param redactValue - Value to replace sensitive data with
 * @returns Sanitized copy of the object
 */
export function sanitizeObject(obj: any, redactValue: string = '[REDACTED]'): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, redactValue));
  }

  const sanitized: any = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    // Check if key matches sensitive field names
    if (SENSITIVE_FIELDS.has(key) || SENSITIVE_FIELDS.has(lowerKey)) {
      sanitized[key] = redactValue;
    } else if (typeof value === 'object' && value !== null) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeObject(value, redactValue);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Sanitizes HTTP headers by redacting sensitive authorization headers
 */
export function sanitizeHeaders(headers: any): any {
  if (!headers || typeof headers !== 'object') {
    return headers;
  }

  const sanitized: any = { ...headers };

  // Redact authorization-related headers
  const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];

  for (const header of sensitiveHeaders) {
    if (sanitized[header]) {
      sanitized[header] = '[REDACTED]';
    }
    // Also check lowercase versions
    const lowerHeader = header.toLowerCase();
    if (sanitized[lowerHeader]) {
      sanitized[lowerHeader] = '[REDACTED]';
    }
  }

  return sanitized;
}

/**
 * Creates a Pino logger instance with automatic redaction of sensitive fields
 */
export function createLogger(options: pino.LoggerOptions = {}) {
  return pino({
    ...options,
    redact: {
      paths: [
        'apiKey',
        'api_key',
        'token',
        'accessToken',
        'access_token',
        'password',
        'passwd',
        'secret',
        'secretKey',
        'privateKey',
        'authorization',
        'cookie',
        'credentials',
        'credentials.apiKey',
        'credentials.token',
        'credentials.password',
        'credentials.accountId',
        'config.credentials',
        'headers.authorization',
        'headers.cookie',
        'headers["x-api-key"]',
        'req.headers.authorization',
        'req.headers.cookie',
        'body.password',
        'body.token',
        'body.apiKey'
      ],
      remove: false // Replace with '[Redacted]' instead of removing
    },
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        ignore: 'pid,hostname',
        translateTime: 'SYS:standard'
      }
    }
  });
}
