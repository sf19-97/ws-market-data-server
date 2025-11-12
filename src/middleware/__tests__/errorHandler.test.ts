import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import { Logger } from 'pino';
import { errorHandler, notFoundHandler, asyncHandler } from '../errorHandler.js';
import { ApiError } from '../validation.js';

describe('Error Handler Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockRequest = {
      path: '/test',
      method: 'GET',
      query: {},
      body: {}
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    nextFunction = jest.fn();
    mockLogger = {
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    } as any;

    // Set development environment by default
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = 'test';
  });

  describe('errorHandler - ApiError handling', () => {
    it('should handle ApiError with status code', () => {
      const error = new ApiError(404, 'Resource not found', 'NOT_FOUND');
      const middleware = errorHandler(mockLogger);

      middleware(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          code: 'NOT_FOUND',
          message: 'Resource not found'
        }),
        'API error'
      );
      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Resource not found',
        code: 'NOT_FOUND'
      });
    });

    it('should handle ApiError without error code', () => {
      const error = new ApiError(400, 'Bad request');
      const middleware = errorHandler(mockLogger);

      middleware(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Bad request',
        code: undefined
      });
    });

    it('should log request path and method', () => {
      const error = new ApiError(403, 'Forbidden');
      const middleware = errorHandler(mockLogger);

      mockRequest.path = '/api/candles';
      mockRequest.method = 'POST';

      middleware(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/api/candles',
          method: 'POST'
        }),
        'API error'
      );
    });
  });

  describe('errorHandler - Database errors', () => {
    it('should handle PostgresError', () => {
      const error = new Error('Connection failed');
      error.name = 'PostgresError';

      const middleware = errorHandler(mockLogger);
      middleware(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Database service unavailable',
        code: 'DATABASE_ERROR'
      });
    });

    it('should handle errors with "database" in message', () => {
      const error = new Error('database connection timeout');

      const middleware = errorHandler(mockLogger);
      middleware(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Database service unavailable',
        code: 'DATABASE_ERROR'
      });
    });
  });

  describe('errorHandler - Validation errors', () => {
    it('should handle ValidationError', () => {
      const error = new Error('Invalid input');
      error.name = 'ValidationError';

      const middleware = errorHandler(mockLogger);
      middleware(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockLogger.warn).toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid input',
        code: 'VALIDATION_ERROR'
      });
    });
  });

  describe('errorHandler - Generic errors', () => {
    it('should expose stack trace in development', () => {
      const error = new Error('Something went wrong');
      error.stack = 'Error stack trace';

      process.env.NODE_ENV = 'development';

      const middleware = errorHandler(mockLogger);
      middleware(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Something went wrong',
        code: 'INTERNAL_ERROR',
        stack: 'Error stack trace'
      });
    });

    it('should hide error details in production', () => {
      const error = new Error('Something went wrong');

      process.env.NODE_ENV = 'production';

      const middleware = errorHandler(mockLogger);
      middleware(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
      expect(mockResponse.json).not.toHaveBeenCalledWith(
        expect.objectContaining({ stack: expect.anything() })
      );
    });

    it('should log full error details including query and body', () => {
      const error = new Error('Unexpected error');
      mockRequest.query = { foo: 'bar' };
      mockRequest.body = { data: 'test' };

      const middleware = errorHandler(mockLogger);
      middleware(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: error,
          path: '/test',
          method: 'GET',
          query: { foo: 'bar' },
          body: { data: 'test' }
        }),
        'Unhandled error'
      );
    });
  });

  describe('notFoundHandler', () => {
    it('should return 404 for unknown routes', () => {
      mockRequest.path = '/unknown/route';

      notFoundHandler(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Endpoint not found',
        code: 'NOT_FOUND',
        path: '/unknown/route'
      });
    });

    it('should include request path in response', () => {
      mockRequest.path = '/api/nonexistent';

      notFoundHandler(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/api/nonexistent'
        })
      );
    });
  });

  describe('asyncHandler', () => {
    it('should handle successful async functions', async () => {
      const asyncFn = jest.fn().mockResolvedValue(undefined);
      const wrappedFn = asyncHandler(asyncFn);

      await wrappedFn(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(asyncFn).toHaveBeenCalledWith(mockRequest, mockResponse, nextFunction);
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should catch rejected promises and call next', async () => {
      const error = new Error('Async error');
      const asyncFn = jest.fn().mockRejectedValue(error);
      const wrappedFn = asyncHandler(asyncFn);

      await wrappedFn(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(error);
    });

    it('should catch thrown errors in async functions', async () => {
      const error = new Error('Thrown error');
      const asyncFn = jest.fn().mockImplementation(async () => {
        throw error;
      });
      const wrappedFn = asyncHandler(asyncFn);

      await wrappedFn(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(error);
    });

    it('should handle ApiError thrown in async functions', async () => {
      const error = new ApiError(404, 'Not found');
      const asyncFn = jest.fn().mockRejectedValue(error);
      const wrappedFn = asyncHandler(asyncFn);

      await wrappedFn(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(error);
    });

    it('should pass through function return value', async () => {
      const asyncFn = jest.fn().mockResolvedValue({ data: 'test' });
      const wrappedFn = asyncHandler(asyncFn);

      await wrappedFn(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(asyncFn).toHaveBeenCalled();
    });
  });

  describe('error logging levels', () => {
    it('should use warn level for ApiError', () => {
      const error = new ApiError(400, 'Bad request');
      const middleware = errorHandler(mockLogger);

      middleware(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockLogger.warn).toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should use error level for unexpected errors', () => {
      const error = new Error('Unexpected');
      const middleware = errorHandler(mockLogger);

      middleware(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });
});
