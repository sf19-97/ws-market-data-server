import { getPool } from '../utils/database.js';

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const TIMEFRAME_MAP: Record<string, string> = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
  '4h': '4 hours',
  '12h': '12 hours'
};

export class CandlesService {
  static validateTimeframe(timeframe: string): boolean {
    return timeframe in TIMEFRAME_MAP;
  }

  static async getCandles(
    symbol: string,
    timeframe: string,
    from: number,
    to: number
  ): Promise<CandleData[]> {
    if (!this.validateTimeframe(timeframe)) {
      throw new Error(`Invalid timeframe: ${timeframe}`);
    }

    const interval = TIMEFRAME_MAP[timeframe];
    const pool = getPool();

    const query = `
      SELECT
        EXTRACT(EPOCH FROM time_bucket($1, time))::bigint AS time,
        (array_agg(mid_price ORDER BY time ASC))[1] AS open,
        MAX(mid_price) AS high,
        MIN(mid_price) AS low,
        (array_agg(mid_price ORDER BY time DESC))[1] AS close
      FROM forex_ticks
      WHERE symbol = $2
        AND time >= to_timestamp($3)
        AND time <= to_timestamp($4)
      GROUP BY time_bucket($1, time)
      ORDER BY time ASC;
    `;

    try {
      const result = await pool.query(query, [interval, symbol, from, to]);
      
      return result.rows.map(row => ({
        time: parseInt(row.time),
        open: parseFloat(parseFloat(row.open).toFixed(5)),
        high: parseFloat(parseFloat(row.high).toFixed(5)),
        low: parseFloat(parseFloat(row.low).toFixed(5)),
        close: parseFloat(parseFloat(row.close).toFixed(5))
      }));
    } catch (error) {
      console.error('Database query error:', error);
      throw new Error('Failed to fetch candle data');
    }
  }
}