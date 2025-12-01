import { Request, Response } from 'express';
import { Pool } from 'pg';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger();

/**
 * Controller for health and metrics endpoints
 */
export class HealthController {
  constructor(
    private pool: Pool,
    private getClientCount: () => number,
    private getSubscriptionCount: () => number
  ) {}

  /**
   * GET /health - Health check with database connectivity
   */
  async health(_req: Request, res: Response): Promise<void> {
    try {
      await this.pool.query('SELECT 1');

      res.json({
        status: 'healthy',
        database: 'connected',
        clients: this.getClientCount(),
        uptime: process.uptime()
      });
    } catch (err) {
      logger.error({ err }, 'Health check failed - database unavailable');
      res.status(503).json({
        status: 'unhealthy',
        database: 'disconnected',
        clients: this.getClientCount(),
        uptime: process.uptime()
      });
    }
  }

  /**
   * GET /metrics - Server metrics
   */
  metrics(_req: Request, res: Response): void {
    res.json({
      connections: this.getClientCount(),
      subscriptions: this.getSubscriptionCount()
    });
  }
}
