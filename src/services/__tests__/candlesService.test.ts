import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Pool, QueryResult } from 'pg';
import { CandlesService } from '../candlesService.js';
import { Timeframe } from '../../types/index.js';

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

describe('CandlesService', () => {
  let service: CandlesService;

  beforeEach(() => {
    service = new CandlesService(mockPool);
    jest.clearAllMocks();
  });

  describe('getCandles - Materialized Views', () => {
    const materializedViewTimeframes: Timeframe[] = ['5m', '15m', '1h', '4h', '12h'];

    materializedViewTimeframes.forEach((timeframe) => {
      it(`should use materialized view for ${timeframe} timeframe`, async () => {
        const mockData = [
          {
            time: '1704067200',
            open: '1.09500',
            high: '1.09600',
            low: '1.09400',
            close: '1.09550'
          }
        ];

        mockPool.query.mockResolvedValue({
          rows: mockData,
          command: 'SELECT',
          rowCount: 1,
          oid: 0,
          fields: []
        } as QueryResult);

        const from = 1704067200; // 2024-01-01
        const to = 1704153600;   // 2024-01-02

        const result = await service.getCandles('EURUSD', timeframe, from, to);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
          time: 1704067200,
          open: expect.any(Number),
          high: expect.any(Number),
          low: expect.any(Number),
          close: expect.any(Number)
        });

        // Verify materialized view was used
        const query = mockPool.query.mock.calls[0][0] as string;
        expect(query).toContain(`forex_candles_${timeframe}`);
      });
    });

    it('should format prices to 5 decimal places', async () => {
      const mockData = [
        {
          time: '1704067200',
          open: '1.095004321',
          high: '1.096008765',
          low: '1.094002134',
          close: '1.095506789'
        }
      ];

      mockPool.query.mockResolvedValue({
        rows: mockData,
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: []
      } as QueryResult);

      const result = await service.getCandles('EURUSD', '1h', 1704067200, 1704153600);

      expect(result[0].open).toBe(1.095);
      expect(result[0].high).toBe(1.09601);
      expect(result[0].low).toBe(1.094);
      expect(result[0].close).toBe(1.09551);
    });

    it('should filter by symbol and date range', async () => {
      mockPool.query.mockResolvedValue({
        rows: [],
        command: 'SELECT',
        rowCount: 0,
        oid: 0,
        fields: []
      } as QueryResult);

      const from = 1704067200;
      const to = 1704153600;

      await service.getCandles('GBPUSD', '1h', from, to);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE symbol = $1'),
        expect.arrayContaining(['GBPUSD', from, to])
      );
    });

    it('should order results by time ascending', async () => {
      mockPool.query.mockResolvedValue({
        rows: [],
        command: 'SELECT',
        rowCount: 0,
        oid: 0,
        fields: []
      } as QueryResult);

      await service.getCandles('EURUSD', '1h', 1704067200, 1704153600);

      const query = mockPool.query.mock.calls[0][0] as string;
      expect(query).toContain('ORDER BY');
      expect(query).toContain('ASC');
    });
  });

  describe('getCandles - Raw Ticks (1m timeframe)', () => {
    it('should use time_bucket for 1m timeframe', async () => {
      const mockData = [
        {
          time: '1704067200',
          open: '1.09500',
          high: '1.09600',
          low: '1.09400',
          close: '1.09550'
        }
      ];

      mockPool.query.mockResolvedValue({
        rows: mockData,
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: []
      } as QueryResult);

      const result = await service.getCandles('EURUSD', '1m', 1704067200, 1704153600);

      expect(result).toHaveLength(1);

      const query = mockPool.query.mock.calls[0][0] as string;
      expect(query).toContain('time_bucket');
      expect(query).toContain('market_ticks');
      expect(query).not.toContain('forex_candles_');
    });

    it('should aggregate OHLC from ticks', async () => {
      const mockData = [
        {
          time: '1704067200',
          open: '1.09500',  // First tick
          high: '1.09700',  // Max price
          low: '1.09300',   // Min price
          close: '1.09550'  // Last tick
        }
      ];

      mockPool.query.mockResolvedValue({
        rows: mockData,
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: []
      } as QueryResult);

      const result = await service.getCandles('EURUSD', '1m', 1704067200, 1704153600);

      expect(result[0].open).toBeLessThanOrEqual(result[0].high);
      expect(result[0].open).toBeGreaterThanOrEqual(result[0].low);
      expect(result[0].close).toBeLessThanOrEqual(result[0].high);
      expect(result[0].close).toBeGreaterThanOrEqual(result[0].low);
    });
  });

  describe('empty results', () => {
    it('should return empty array when no data exists', async () => {
      mockPool.query.mockResolvedValue({
        rows: [],
        command: 'SELECT',
        rowCount: 0,
        oid: 0,
        fields: []
      } as QueryResult);

      const result = await service.getCandles('EURUSD', '1h', 1704067200, 1704153600);

      expect(result).toEqual([]);
    });

    it('should handle date range with no data', async () => {
      mockPool.query.mockResolvedValue({
        rows: [],
        command: 'SELECT',
        rowCount: 0,
        oid: 0,
        fields: []
      } as QueryResult);

      // Very old date range
      const from = 946684800;  // 2000-01-01
      const to = 978220800;    // 2001-01-01

      const result = await service.getCandles('EURUSD', '1h', from, to);

      expect(result).toEqual([]);
    });
  });

  describe('multiple candles', () => {
    it('should return multiple candles in order', async () => {
      const mockData = [
        { time: '1704067200', open: '1.09500', high: '1.09600', low: '1.09400', close: '1.09550' },
        { time: '1704070800', open: '1.09550', high: '1.09700', low: '1.09500', close: '1.09650' },
        { time: '1704074400', open: '1.09650', high: '1.09750', low: '1.09600', close: '1.09700' }
      ];

      mockPool.query.mockResolvedValue({
        rows: mockData,
        command: 'SELECT',
        rowCount: 3,
        oid: 0,
        fields: []
      } as QueryResult);

      const result = await service.getCandles('EURUSD', '1h', 1704067200, 1704153600);

      expect(result).toHaveLength(3);
      expect(result[0].time).toBeLessThan(result[1].time);
      expect(result[1].time).toBeLessThan(result[2].time);
    });

    it('should handle large result sets', async () => {
      const mockData = Array.from({ length: 100 }, (_, i) => ({
        time: String(1704067200 + i * 3600),
        open: '1.09500',
        high: '1.09600',
        low: '1.09400',
        close: '1.09550'
      }));

      mockPool.query.mockResolvedValue({
        rows: mockData,
        command: 'SELECT',
        rowCount: 100,
        oid: 0,
        fields: []
      } as QueryResult);

      const result = await service.getCandles('EURUSD', '1h', 1704067200, 1704153600);

      expect(result).toHaveLength(100);
    });
  });

  describe('error handling', () => {
    it('should propagate database errors', async () => {
      const dbError = new Error('Query timeout');
      mockPool.query.mockRejectedValue(dbError);

      await expect(
        service.getCandles('EURUSD', '1h', 1704067200, 1704153600)
      ).rejects.toThrow('Query timeout');
    });

    it('should handle malformed data gracefully', async () => {
      const mockData = [
        { time: 'invalid', open: 'NaN', high: null, low: undefined, close: '1.09' }
      ];

      mockPool.query.mockResolvedValue({
        rows: mockData,
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: []
      } as QueryResult);

      const result = await service.getCandles('EURUSD', '1h', 1704067200, 1704153600);

      // Should attempt to parse, may result in NaN but shouldn't crash
      expect(result).toBeDefined();
    });
  });

  describe('symbol normalization', () => {
    it('should handle normalized symbol format', async () => {
      mockPool.query.mockResolvedValue({
        rows: [],
        command: 'SELECT',
        rowCount: 0,
        oid: 0,
        fields: []
      } as QueryResult);

      // Symbol without slash (already normalized)
      await service.getCandles('EURUSD', '1h', 1704067200, 1704153600);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['EURUSD'])
      );
    });
  });

  describe('performance considerations', () => {
    it('should use parameterized queries to prevent SQL injection', async () => {
      mockPool.query.mockResolvedValue({
        rows: [],
        command: 'SELECT',
        rowCount: 0,
        oid: 0,
        fields: []
      } as QueryResult);

      await service.getCandles('EURUSD', '1h', 1704067200, 1704153600);

      // Verify parameterized query ($1, $2, $3)
      const [query, params] = mockPool.query.mock.calls[0];
      expect(query).toContain('$1');
      expect(query).toContain('$2');
      expect(query).toContain('$3');
      expect(params).toHaveLength(3);
    });
  });
});
