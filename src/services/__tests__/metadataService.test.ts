import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Pool, QueryResult } from 'pg';
import { MetadataService } from '../metadataService.js';
import { SymbolMetadata } from '../../types/index.js';

// Create mock pool object
const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockEnd = jest.fn();

const mockPool = {
  query: mockQuery,
  connect: mockConnect,
  end: mockEnd,
} as unknown as Pool;

// Mock pg Pool
jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPool),
}));

describe('MetadataService', () => {
  let service: MetadataService;

  beforeEach(() => {
    service = new MetadataService(mockPool);
    jest.clearAllMocks();
  });

  describe('getSymbolMetadata', () => {
    it('should return metadata for existing symbol', async () => {
      const mockData = {
        symbol: 'EURUSD',
        earliest: new Date('2024-01-01T00:00:00Z'),
        latest: new Date('2024-12-31T23:59:59Z'),
        tick_count: '1000000'
      };

      mockPool.query.mockResolvedValue({
        rows: [mockData],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: []
      } as QueryResult);

      const result = await service.getSymbolMetadata('EURUSD');

      expect(result).toBeDefined();
      expect(result).toMatchObject({
        symbol: 'EURUSD',
        earliest: expect.any(Number),
        latest: expect.any(Number),
        tick_count: 1000000
      });
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['EURUSD']
      );
    });

    it('should return null for non-existent symbol', async () => {
      mockPool.query.mockResolvedValue({
        rows: [],
        command: 'SELECT',
        rowCount: 0,
        oid: 0,
        fields: []
      } as QueryResult);

      const result = await service.getSymbolMetadata('INVALID');

      expect(result).toBeNull();
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['INVALID']
      );
    });

    it('should include timeframes in metadata', async () => {
      const mockData = {
        symbol: 'GBPUSD',
        earliest: new Date('2024-01-01'),
        latest: new Date('2024-12-31'),
        tick_count: '500000'
      };

      mockPool.query.mockResolvedValue({
        rows: [mockData],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: []
      } as QueryResult);

      const result = await service.getSymbolMetadata('GBPUSD');

      expect(result?.timeframes).toBeDefined();
      expect(result?.timeframes).toContain('1m');
      expect(result?.timeframes).toContain('1h');
      expect(result?.timeframes).toContain('12h');
    });

    it('should convert timestamps correctly', async () => {
      const mockData = {
        symbol: 'USDJPY',
        earliest: new Date('2024-06-15T10:30:00Z'),
        latest: new Date('2024-06-15T18:45:00Z'),
        tick_count: '100'
      };

      mockPool.query.mockResolvedValue({
        rows: [mockData],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: []
      } as QueryResult);

      const result = await service.getSymbolMetadata('USDJPY');

      // Verify timestamps are in Unix epoch seconds
      expect(result?.earliest).toBeGreaterThan(1700000000); // After 2023
      expect(result?.latest).toBeGreaterThan(result?.earliest);
    });
  });

  describe('getAllSymbols', () => {
    it('should return all symbols with metadata', async () => {
      const mockData = [
        {
          symbol: 'EURUSD',
          earliest: new Date('2024-01-01'),
          latest: new Date('2024-12-31'),
          tick_count: '1000000'
        },
        {
          symbol: 'GBPUSD',
          earliest: new Date('2024-02-01'),
          latest: new Date('2024-12-31'),
          tick_count: '800000'
        }
      ];

      mockPool.query.mockResolvedValue({
        rows: mockData,
        command: 'SELECT',
        rowCount: 2,
        oid: 0,
        fields: []
      } as QueryResult);

      const result = await service.getAllSymbols();

      expect(result.symbols).toHaveLength(2);
      expect(result.symbols[0].symbol).toBe('EURUSD');
      expect(result.symbols[1].symbol).toBe('GBPUSD');
      expect(result.timeframes).toBeDefined();
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no symbols exist', async () => {
      mockPool.query.mockResolvedValue({
        rows: [],
        command: 'SELECT',
        rowCount: 0,
        oid: 0,
        fields: []
      } as QueryResult);

      const result = await service.getAllSymbols();

      expect(result.symbols).toEqual([]);
      expect(result.timeframes).toBeDefined();
    });

    it('should order symbols alphabetically', async () => {
      const mockData = [
        { symbol: 'GBPUSD', earliest: new Date(), latest: new Date(), tick_count: '100' },
        { symbol: 'EURUSD', earliest: new Date(), latest: new Date(), tick_count: '200' },
        { symbol: 'USDJPY', earliest: new Date(), latest: new Date(), tick_count: '300' }
      ];

      mockPool.query.mockResolvedValue({
        rows: mockData,
        command: 'SELECT',
        rowCount: 3,
        oid: 0,
        fields: []
      } as QueryResult);

      const result = await service.getAllSymbols();

      // Verify the SQL query includes ORDER BY
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY')
      );
    });
  });

  describe('symbolExists', () => {
    it('should return true for existing symbol', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ exists: true }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: []
      } as QueryResult);

      const result = await service.symbolExists('EURUSD');

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT 1'),
        ['EURUSD']
      );
    });

    it('should return false for non-existent symbol', async () => {
      mockPool.query.mockResolvedValue({
        rows: [],
        command: 'SELECT',
        rowCount: 0,
        oid: 0,
        fields: []
      } as QueryResult);

      const result = await service.symbolExists('INVALID');

      expect(result).toBe(false);
    });

    it('should use LIMIT 1 for performance', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ exists: true }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: []
      } as QueryResult);

      await service.symbolExists('EURUSD');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT 1'),
        ['EURUSD']
      );
    });
  });

  describe('getSymbolDateRange', () => {
    it('should return date range for existing symbol', async () => {
      const mockData = {
        earliest: new Date('2024-01-01T00:00:00Z'),
        latest: new Date('2024-12-31T23:59:59Z')
      };

      mockPool.query.mockResolvedValue({
        rows: [mockData],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: []
      } as QueryResult);

      const result = await service.getSymbolDateRange('EURUSD');

      expect(result).toBeDefined();
      expect(result?.earliest).toBeGreaterThan(0);
      expect(result?.latest).toBeGreaterThan(result?.earliest);
    });

    it('should return null for non-existent symbol', async () => {
      mockPool.query.mockResolvedValue({
        rows: [],
        command: 'SELECT',
        rowCount: 0,
        oid: 0,
        fields: []
      } as QueryResult);

      const result = await service.getSymbolDateRange('INVALID');

      expect(result).toBeNull();
    });

    it('should return null when earliest is null', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ earliest: null, latest: null }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: []
      } as QueryResult);

      const result = await service.getSymbolDateRange('EMPTY');

      expect(result).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should propagate database errors', async () => {
      const dbError = new Error('Database connection failed');
      mockPool.query.mockRejectedValue(dbError);

      await expect(service.getSymbolMetadata('EURUSD')).rejects.toThrow('Database connection failed');
    });

    it('should handle malformed query results gracefully', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ invalid: 'data' }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: []
      } as QueryResult);

      // Should not throw, but return data as-is (let caller handle)
      const result = await service.getSymbolMetadata('TEST');
      expect(result).toBeDefined();
    });
  });
});
