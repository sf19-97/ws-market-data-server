import { Router } from 'express';
import { MetadataController } from '../controllers/MetadataController.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { apiLimiter } from '../../middleware/rateLimiter.js';
import { schemas, validateQuery } from '../../middleware/validation.js';

/**
 * Create metadata routes
 */
export function createMetadataRoutes(controller: MetadataController): Router {
  const router = Router();

  router.get('/api/metadata',
    apiLimiter,
    validateQuery(schemas.metadata),
    asyncHandler(async (req, res) => {
      await controller.getMetadata(req, res);
    })
  );

  router.get('/api/metadata/:symbol',
    apiLimiter,
    asyncHandler(async (req, res) => {
      await controller.getSymbolMetadata(req, res);
    })
  );

  return router;
}
