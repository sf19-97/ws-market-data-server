import { Router } from 'express';
import { CandlesController } from '../controllers/CandlesController.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { strictLimiter } from '../../middleware/rateLimiter.js';
import { schemas, validateQuery } from '../../middleware/validation.js';

/**
 * Create candles routes
 */
export function createCandlesRoutes(controller: CandlesController): Router {
  const router = Router();

  router.get('/api/candles',
    strictLimiter,
    validateQuery(schemas.candles),
    asyncHandler(async (req, res) => {
      await controller.getCandles(req, res);
    })
  );

  router.get('/api/candles/:symbol/:timeframe',
    strictLimiter,
    asyncHandler(async (req, res) => {
      await controller.getCandlesByPath(req, res);
    })
  );

  return router;
}
