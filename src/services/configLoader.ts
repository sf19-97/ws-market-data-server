import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';
import { join } from 'path';
import { ServerConfig } from '../types/index.js';
import { createLogger } from '../utils/logger.js';
import { DEFAULT_BROKER_CONFIGS, DEFAULT_SERVER_CONFIG } from '../utils/constants.js';

const logger = createLogger();

/**
 * Load server configuration from config.yaml or use defaults
 */
export function loadConfig(): ServerConfig {
  const configPath = join(process.cwd(), 'config', 'config.yaml');

  if (!existsSync(configPath)) {
    logger.info('No config.yaml found, using default configuration');
    return getDefaultConfig();
  }

  try {
    const configFile = readFileSync(configPath, 'utf8');
    const config = parse(configFile);
    return config;
  } catch (err) {
    logger.error({ err }, 'Failed to load config');
    return getDefaultConfig();
  }
}

/**
 * Get default server configuration
 */
function getDefaultConfig(): ServerConfig {
  return {
    server: DEFAULT_SERVER_CONFIG,
    brokers: [
      DEFAULT_BROKER_CONFIGS.binance,
      DEFAULT_BROKER_CONFIGS.oanda
    ]
  };
}
