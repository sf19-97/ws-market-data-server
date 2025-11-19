import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createLogger } from '../utils/logger.js';

const logger = createLogger();

export interface Tick {
  timestamp: number; // UNIX seconds (not milliseconds!)
  bid: number;
  ask: number;
}

/**
 * Cloudflare R2 Client for uploading tick data to the data lake
 *
 * Uploads batches of ticks to R2 storage in the following structure:
 * ticks/{SYMBOL}/{YYYY}/{MM}/{DD}/part-{timestamp}.json
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
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
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
  } catch (error) {
    logger.warn('R2 client not available - continuing without R2 uploads');
    return null;
  }
}
