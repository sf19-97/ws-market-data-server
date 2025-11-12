import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import { validateQuery, sanitizeSymbol, validateMaterializedViewName, ApiError, schemas } from '../validation.js';

describe('Validation Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRequest = {
      query: {},
      body: {}
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    nextFunction = jest.fn();
  });

  describe('validateQuery - metadata schema', () => {
    it('should pass validation for valid symbol', () => {
      mockRequest.query = { symbol: 'EURUSD' };

      const middleware = validateQuery(schemas.metadata);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should pass validation when symbol is omitted (optional)', () => {
      mockRequest.query = {};

      const middleware = validateQuery(schemas.metadata);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should reject symbol with wrong format', () => {
      mockRequest.query = { symbol: 'EUR/USD' }; // Has slash

      const middleware = validateQuery(schemas.metadata);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Validation failed',
          details: expect.arrayContaining([
            expect.objectContaining({
              field: 'symbol',
              message: expect.stringContaining('6 uppercase letters')
            })
          ])
        })
      );
    });

    it('should reject symbol with wrong length', () => {
      mockRequest.query = { symbol: 'EUR' }; // Too short

      const middleware = validateQuery(schemas.metadata);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });

    it('should reject lowercase symbols', () => {
      mockRequest.query = { symbol: 'eurusd' };

      const middleware = validateQuery(schemas.metadata);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });
  });

  describe('validateQuery - candles schema', () => {
    const validQuery = {
      symbol: 'EURUSD',
      timeframe: '1h',
      from: '1704067200',
      to: '1704153600'
    };

    it('should pass validation for valid candles query', () => {
      mockRequest.query = { ...validQuery };

      const middleware = validateQuery(schemas.candles);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should transform string timestamps to numbers', () => {
      mockRequest.query = { ...validQuery };

      const middleware = validateQuery(schemas.candles);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockRequest.query.from).toBe(1704067200);
      expect(mockRequest.query.to).toBe(1704153600);
    });

    it('should apply default timeframe when omitted', () => {
      mockRequest.query = {
        symbol: 'EURUSD',
        from: '1704067200',
        to: '1704153600'
      };

      const middleware = validateQuery(schemas.candles);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockRequest.query.timeframe).toBe('1h');
    });

    it('should reject invalid timeframe', () => {
      mockRequest.query = {
        ...validQuery,
        timeframe: '30m' // Invalid timeframe
      };

      const middleware = validateQuery(schemas.candles);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Validation failed'
        })
      );
    });

    it('should reject when from >= to', () => {
      mockRequest.query = {
        ...validQuery,
        from: '1704153600',
        to: '1704067200' // from > to
      };

      const middleware = validateQuery(schemas.candles);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.arrayContaining([
            expect.objectContaining({
              message: expect.stringContaining('before to timestamp')
            })
          ])
        })
      );
    });

    it('should reject date range exceeding 1 year', () => {
      const from = 1704067200;  // 2024-01-01
      const to = from + (366 * 24 * 60 * 60); // More than 1 year later

      mockRequest.query = {
        ...validQuery,
        from: String(from),
        to: String(to)
      };

      const middleware = validateQuery(schemas.candles);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.arrayContaining([
            expect.objectContaining({
              message: expect.stringContaining('cannot exceed 1 year')
            })
          ])
        })
      );
    });

    it('should reject non-numeric timestamps', () => {
      mockRequest.query = {
        ...validQuery,
        from: 'invalid'
      };

      const middleware = validateQuery(schemas.candles);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });

    it('should reject missing required fields', () => {
      mockRequest.query = {
        symbol: 'EURUSD'
        // Missing from and to
      };

      const middleware = validateQuery(schemas.candles);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });

    it('should accept all valid timeframes', () => {
      const timeframes = ['1m', '5m', '15m', '1h', '4h', '12h'];

      timeframes.forEach((timeframe) => {
        mockRequest.query = {
          ...validQuery,
          timeframe
        };

        const middleware = validateQuery(schemas.candles);
        middleware(mockRequest as Request, mockResponse as Response, nextFunction);

        expect(nextFunction).toHaveBeenCalled();
        nextFunction.mockClear();
      });
    });
  });

  describe('sanitizeSymbol', () => {
    it('should remove slashes from symbols', () => {
      expect(sanitizeSymbol('EUR/USD')).toBe('EURUSD');
      expect(sanitizeSymbol('GBP/JPY')).toBe('GBPJPY');
    });

    it('should convert to uppercase', () => {
      expect(sanitizeSymbol('eurusd')).toBe('EURUSD');
      expect(sanitizeSymbol('gbp/usd')).toBe('GBPUSD');
    });

    it('should handle already-sanitized symbols', () => {
      expect(sanitizeSymbol('EURUSD')).toBe('EURUSD');
    });

    it('should remove multiple slashes', () => {
      expect(sanitizeSymbol('EUR//USD')).toBe('EURUSD');
    });

    it('should handle empty string', () => {
      expect(sanitizeSymbol('')).toBe('');
    });
  });

  describe('validateMaterializedViewName', () => {
    it('should allow valid materialized view names', () => {
      const validNames = [
        'forex_candles_5m',
        'forex_candles_15m',
        'forex_candles_1h',
        'forex_candles_4h',
        'forex_candles_12h'
      ];

      validNames.forEach((name) => {
        expect(() => validateMaterializedViewName(name)).not.toThrow();
      });
    });

    it('should reject invalid view names (SQL injection prevention)', () => {
      const invalidNames = [
        'market_ticks',
        'forex_candles_1m',
        'forex_candles_5m; DROP TABLE users;',
        'forex_candles_5m\'',
        '../../../etc/passwd'
      ];

      invalidNames.forEach((name) => {
        expect(() => validateMaterializedViewName(name)).toThrow(ApiError);
        expect(() => validateMaterializedViewName(name)).toThrow('Invalid timeframe');
      });
    });

    it('should throw ApiError with correct status code', () => {
      try {
        validateMaterializedViewName('invalid_view');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).statusCode).toBe(400);
        expect((error as ApiError).code).toBe('INVALID_TIMEFRAME');
      }
    });
  });

  describe('ApiError class', () => {
    it('should create error with all properties', () => {
      const error = new ApiError(404, 'Resource not found', 'NOT_FOUND');

      expect(error).toBeInstanceOf(Error);
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('Resource not found');
      expect(error.code).toBe('NOT_FOUND');
      expect(error.name).toBe('ApiError');
    });

    it('should work without error code', () => {
      const error = new ApiError(500, 'Internal error');

      expect(error.statusCode).toBe(500);
      expect(error.message).toBe('Internal error');
      expect(error.code).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should handle query parameters with extra whitespace', () => {
      mockRequest.query = {
        symbol: ' EURUSD ',
        timeframe: ' 1h ',
        from: ' 1704067200 ',
        to: ' 1704153600 '
      };

      const middleware = validateQuery(schemas.candles);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      // Zod should trim or fail validation
      // Depending on schema, this might fail or succeed
      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });

    it('should handle timestamp as number instead of string', () => {
      mockRequest.query = {
        symbol: 'EURUSD',
        from: 1704067200 as any, // Number instead of string
        to: 1704153600 as any
      };

      const middleware = validateQuery(schemas.candles);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      // Should fail because Zod expects string, not number
      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });
  });
});
