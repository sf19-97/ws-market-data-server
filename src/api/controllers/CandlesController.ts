import { Request, Response } from 'express';
import crypto from 'crypto';
import { CandlesService } from '../../services/candlesService.js';
import { MetadataService } from '../../services/metadataService.js';
import { ApiError, sanitizeSymbol } from '../../middleware/validation.js';
import { CACHE_DURATIONS } from '../../utils/constants.js';
import { Timeframe } from '../../types/index.js';

/**
 * Controller for candles API endpoints
 */
export class CandlesController {
  constructor(
    private candlesService: CandlesService,
    private metadataService: MetadataService
  ) {}

  /**
   * GET /api/candles - Get candles with query parameters
   */
  async getCandles(req: Request, res: Response): Promise<void> {
    const { symbol, timeframe, from, to } = req.query as unknown as {
      symbol: string;
      timeframe: Timeframe;
      from: number;
      to: number;
    };

    const normalizedSymbol = sanitizeSymbol(symbol);

    // Generate ETag for browser caching
    const cacheKey = `${normalizedSymbol}-${timeframe}-${from}-${to}`;
    const etag = crypto.createHash('md5').update(cacheKey).digest('hex');

    // Check if client has valid cache
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    const candles = await this.candlesService.getCandles(
      normalizedSymbol,
      timeframe,
      from,
      to
    );

    // Set cache headers
    const cacheDuration = CACHE_DURATIONS[timeframe] || CACHE_DURATIONS.default;
    res.set({
      'Cache-Control': `public, max-age=${cacheDuration}`,
      'ETag': etag,
      'Vary': 'Accept-Encoding',
      'Last-Modified': new Date().toUTCString()
    });

    res.json(candles);
  }

  /**
   * GET /api/candles/:symbol/:timeframe - Get candles with path parameters
   */
  async getCandlesByPath(req: Request, res: Response): Promise<void> {
    const { symbol, timeframe } = req.params;
    const { from, to } = req.query as { from?: string; to?: string };

    // Validate required query parameters
    if (!from || !to) {
      throw new ApiError(
        400,
        "Missing required query parameters: 'from' and 'to' (Unix timestamps in seconds)",
        'MISSING_PARAMETERS'
      );
    }

    const normalizedSymbol = sanitizeSymbol(symbol);
    const fromTimestamp = parseInt(from);
    const toTimestamp = parseInt(to);

    // Validate timeframe
    if (!['1m', '5m', '15m', '1h', '4h', '12h'].includes(timeframe)) {
      throw new ApiError(
        400,
        `Invalid timeframe '${timeframe}'. Must be one of: 1m, 5m, 15m, 1h, 4h, 12h`,
        'INVALID_TIMEFRAME'
      );
    }

    // Check if symbol exists
    const symbolExists = await this.metadataService.symbolExists(normalizedSymbol);
    if (!symbolExists) {
      throw new ApiError(
        404,
        `Symbol '${normalizedSymbol}' not found in database`,
        'SYMBOL_NOT_FOUND'
      );
    }

    // Get available date range
    const dateRange = await this.metadataService.getSymbolMetadata(normalizedSymbol);

    // Generate ETag for caching
    const cacheKey = `${normalizedSymbol}-${timeframe}-${fromTimestamp}-${toTimestamp}`;
    const etag = crypto.createHash('md5').update(cacheKey).digest('hex');

    // Check client cache
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    const candles = await this.candlesService.getCandles(
      normalizedSymbol,
      timeframe as Timeframe,
      fromTimestamp,
      toTimestamp
    );

    // Set cache headers
    const cacheDuration = CACHE_DURATIONS[timeframe as Timeframe] || CACHE_DURATIONS.default;
    res.set({
      'Cache-Control': `public, max-age=${cacheDuration}`,
      'ETag': etag,
      'Vary': 'Accept-Encoding',
      'Last-Modified': new Date().toUTCString()
    });

    // Add helpful headers when no data
    if (candles.length === 0 && dateRange) {
      res.set({
        'X-Data-Available': 'false',
        'X-Available-From': new Date(dateRange.earliest * 1000).toISOString(),
        'X-Available-To': new Date(dateRange.latest * 1000).toISOString(),
        'Warning': '199 - "No data available for requested date range. Check X-Available-From and X-Available-To headers."'
      });
    }

    res.json(candles);
  }
}
