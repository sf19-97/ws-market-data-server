/**
 * Routes - HTTP route definitions
 *
 * Each route module creates an Express Router configured
 * with the appropriate controller and middleware.
 */

export { createHealthRoutes } from './health.js';
export { createMetadataRoutes } from './metadata.js';
export { createCandlesRoutes } from './candles.js';
