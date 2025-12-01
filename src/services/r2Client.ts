import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  ListObjectsV2CommandOutput
} from '@aws-sdk/client-s3';
import { createLogger } from '../utils/logger.js';

const logger = createLogger();

export interface Tick {
  timestamp: number; // UNIX seconds (not milliseconds!)
  bid: number;
  ask: number;
}

export interface Candle {
  time: Date;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

interface RawCandle {
  time: string;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

/**
 * Cloudflare R2 Client for uploading tick and candle data to the data lake
 *
 * Data structure:
 * - Ticks: ticks/{SYMBOL}/{YYYY}/{MM}/{DD}/part-{timestamp}.json
 * - Candles: candles/{SYMBOL}/{YYYY}/{MM}/part-{timestamp}.json
 */
export class R2Client {
  private s3: S3Client;
  private bucketName: string;

  constructor() {
    const endpoint = process.env.R2_ENDPOINT;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucketName = process.env.R2_BUCKET_NAME;

    if (!endpoint || !accessKeyId || !secretAccessKey || !bucketName) {
      logger.warn('R2 credentials not configured - R2 uploads disabled');
      throw new Error('R2 credentials not configured');
    }

    this.bucketName = bucketName;

    this.s3 = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });

    logger.info({ endpoint, bucketName }, 'R2 client initialized');
  }

  /**
   * Upload a batch of ticks to R2
   *
   * @param symbol Trading symbol (e.g., "EURUSD")
   * @param date Date for partitioning
   * @param ticks Array of ticks to upload
   * @returns Promise resolving to the R2 key
   */
  async uploadTicks(symbol: string, date: Date, ticks: Tick[]): Promise<string> {
    // CRITICAL: Use UTC methods to avoid timezone issues!
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const timestamp = Date.now();

    const key = `ticks/${symbol}/${year}/${month}/${day}/part-${timestamp}.json`;

    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: JSON.stringify(ticks),
        ContentType: 'application/json'
      }));

      logger.debug({ key, tickCount: ticks.length }, 'Uploaded ticks to R2');

      return key;
    } catch (error) {
      logger.error({ error, key }, 'Failed to upload ticks to R2');
      throw error;
    }
  }

  /**
   * Upload a batch of 5-minute candles to R2
   *
   * @param symbol Trading symbol (e.g., "EURUSD")
   * @param date Date for partitioning
   * @param candles Array of candles to upload
   * @returns Promise resolving to the R2 key
   */
  async uploadCandles(symbol: string, date: Date, candles: Candle[]): Promise<string> {
    // CRITICAL: Use UTC methods to avoid timezone issues!
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const timestamp = Date.now();

    const key = `candles/${symbol}/${year}/${month}/part-${timestamp}.json`;

    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: JSON.stringify(candles),
        ContentType: 'application/json'
      }));

      logger.debug({ key, candleCount: candles.length }, 'Uploaded candles to R2');

      return key;
    } catch (error) {
      logger.error({ error, key }, 'Failed to upload candles to R2');
      throw error;
    }
  }

  /**
   * List all tick files for a given symbol and date from R2
   * Handles pagination (max 1000 objects per request)
   *
   * @param symbol Trading symbol (e.g., "EURUSD")
   * @param date Date to list files for
   * @returns Array of R2 object keys
   */
  async listTickFiles(symbol: string, date: Date): Promise<string[]> {
    // CRITICAL: Use UTC methods to avoid timezone issues!
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');

    const prefix = `ticks/${symbol}/${year}/${month}/${day}/`;

    logger.debug({ prefix }, 'Listing tick files from R2');

    const keys: string[] = [];
    let continuationToken: string | undefined = undefined;

    do {
      const command: ListObjectsV2Command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken
      });

      const response: ListObjectsV2CommandOutput = await this.s3.send(command);

      if (response.Contents) {
        for (const object of response.Contents) {
          if (object.Key) {
            keys.push(object.Key);
          }
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken); // Keep paginating until no more results

    logger.debug({ prefix, fileCount: keys.length }, 'Listed tick files');
    return keys;
  }

  /**
   * List all candle files for a given symbol and month from R2
   * Handles pagination (max 1000 objects per request)
   *
   * @param symbol Trading symbol (e.g., "EURUSD")
   * @param date Date to list files for (year/month extracted)
   * @returns Array of R2 object keys
   */
  async listCandleFiles(symbol: string, date: Date): Promise<string[]> {
    // CRITICAL: Use UTC methods to avoid timezone issues!
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');

    const prefix = `candles/${symbol}/${year}/${month}/`;

    logger.debug({ prefix }, 'Listing candle files from R2');

    const keys: string[] = [];
    let continuationToken: string | undefined = undefined;

    do {
      const command: ListObjectsV2Command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken
      });

      const response: ListObjectsV2CommandOutput = await this.s3.send(command);

      if (response.Contents) {
        for (const object of response.Contents) {
          if (object.Key) {
            keys.push(object.Key);
          }
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken); // Keep paginating until no more results

    logger.debug({ prefix, fileCount: keys.length }, 'Listed candle files');
    return keys;
  }

  /**
   * Download and parse a single tick file from R2
   *
   * @param key R2 object key
   * @returns Array of ticks from the file
   */
  async downloadTickFile(key: string): Promise<Tick[]> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key
    });

    try {
      const response = await this.s3.send(command);

      if (!response.Body) {
        throw new Error(`No body in response for key: ${key}`);
      }

      // Convert stream to string
      const bodyString = await response.Body.transformToString();
      const ticks: Tick[] = JSON.parse(bodyString);

      logger.debug({ key, tickCount: ticks.length }, 'Downloaded tick file');
      return ticks;
    } catch (error) {
      logger.error({ error, key }, 'Failed to download tick file from R2');
      throw error;
    }
  }

  /**
   * Download and parse a single 5-minute candle file from R2
   *
   * @param key R2 object key
   * @returns Array of candles from the file
   */
  async downloadCandleFile(key: string): Promise<Candle[]> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key
    });

    try {
      const response = await this.s3.send(command);

      if (!response.Body) {
        throw new Error(`No body in response for key: ${key}`);
      }

      // Convert stream to string
      const bodyString = await response.Body.transformToString();
      const rawCandles: RawCandle[] = JSON.parse(bodyString);

      // Convert time strings back to Date objects
      const candles: Candle[] = rawCandles.map((c) => ({
        ...c,
        time: new Date(c.time)
      }));

      logger.debug({ key, candleCount: candles.length }, 'Downloaded candle file');
      return candles;
    } catch (error) {
      logger.error({ error, key }, 'Failed to download candle file from R2');
      throw error;
    }
  }

  /**
   * Download and merge all tick files for a given symbol and date
   * Automatically sorts ticks by timestamp
   *
   * @param symbol Trading symbol (e.g., "EURUSD")
   * @param date Date to download ticks for
   * @returns Sorted array of all ticks for the date
   */
  async downloadAllTicks(symbol: string, date: Date): Promise<Tick[]> {
    const keys = await this.listTickFiles(symbol, date);

    if (keys.length === 0) {
      logger.debug({ symbol, date }, 'No tick files found');
      return [];
    }

    logger.debug({ symbol, date, fileCount: keys.length }, 'Downloading tick files');

    const allTicks: Tick[] = [];

    for (const key of keys) {
      const ticks = await this.downloadTickFile(key);
      // Avoid stack overflow from spread operator with large arrays
      for (const tick of ticks) {
        allTicks.push(tick);
      }
    }

    // Sort by timestamp (CRITICAL for candle building)
    allTicks.sort((a, b) => a.timestamp - b.timestamp);

    logger.info({ symbol, date, tickCount: allTicks.length }, 'Downloaded and merged all ticks');
    return allTicks;
  }

  /**
   * Download and merge all 5-minute candle files for a given symbol and date
   * Automatically sorts candles by time
   *
   * @param symbol Trading symbol (e.g., "EURUSD")
   * @param date Date to download candles for
   * @returns Sorted array of all candles for the date
   */
  async downloadAllCandles(symbol: string, date: Date): Promise<Candle[]> {
    const keys = await this.listCandleFiles(symbol, date);

    if (keys.length === 0) {
      logger.debug({ symbol, date }, 'No candle files found');
      return [];
    }

    logger.debug({ symbol, date, fileCount: keys.length }, 'Downloading candle files');

    const allCandles: Candle[] = [];

    for (const key of keys) {
      const candles = await this.downloadCandleFile(key);
      for (const candle of candles) {
        allCandles.push(candle);
      }
    }

    // Sort by time
    allCandles.sort((a, b) => a.time.getTime() - b.time.getTime());

    logger.info({ symbol, date, candleCount: allCandles.length }, 'Downloaded and merged all candles');
    return allCandles;
  }

  /**
   * Check if tick data exists in R2 for a given date range
   *
   * @param symbol Trading symbol (e.g., "EURUSD")
   * @param startDate Start date (inclusive)
   * @param endDate End date (inclusive)
   * @returns True if at least one tick file exists for any date in the range
   */
  async hasTicksForDateRange(symbol: string, startDate: Date, endDate: Date): Promise<boolean> {
    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const files = await this.listTickFiles(symbol, currentDate);

      if (files.length > 0) {
        return true; // Found at least one file
      }

      // Move to next day
      currentDate = new Date(currentDate);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return false; // No files found in entire range
  }

  /**
   * Check if 5-minute candle data exists in R2 for a given date range
   *
   * @param symbol Trading symbol (e.g., "EURUSD")
   * @param startDate Start date (inclusive)
   * @param endDate End date (inclusive)
   * @returns True if at least one candle file exists for any date in the range
   */
  async hasCandlesForDateRange(symbol: string, startDate: Date, endDate: Date): Promise<boolean> {
    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const files = await this.listCandleFiles(symbol, currentDate);

      if (files.length > 0) {
        return true; // Found at least one file
      }

      // Move to next day
      currentDate = new Date(currentDate);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return false; // No files found in entire range
  }

  /**
   * Check if R2 client is configured and ready
   */
  isConfigured(): boolean {
    return !!(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID);
  }

  /**
   * Get the S3 client instance (for direct operations)
   */
  get s3Client(): S3Client {
    return this.s3;
  }
}

// Singleton instance
let r2ClientInstance: R2Client | null = null;

/**
 * Get R2 client singleton instance
 * Returns null if R2 is not configured (graceful degradation)
 */
export function getR2Client(): R2Client | null {
  if (r2ClientInstance) {
    return r2ClientInstance;
  }

  try {
    r2ClientInstance = new R2Client();
    return r2ClientInstance;
  } catch {
    logger.warn('R2 client not available - continuing without R2 uploads');
    return null;
  }
}
