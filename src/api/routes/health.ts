import { Router } from 'express';
import { HealthController } from '../controllers/HealthController.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { healthLimiter } from '../../middleware/rateLimiter.js';

/**
 * Create health routes
 */
export function createHealthRoutes(controller: HealthController): Router {
  const router = Router();

  router.get('/health', healthLimiter, asyncHandler(async (req, res) => {
    await controller.health(req, res);
  }));

  router.get('/metrics', healthLimiter, (req, res) => {
    controller.metrics(req, res);
  });

  return router;
}
