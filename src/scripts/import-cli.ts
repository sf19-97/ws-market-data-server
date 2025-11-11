#!/usr/bin/env tsx
/**
 * CLI tool for importing historical Dukascopy data
 *
 * Usage:
 *   npm run import -- --symbol EURUSD --days 7
 *   npm run import -- --symbol EURUSD --from 2024-01-01 --to 2024-01-31
 *   npm run import -- --symbol BTCUSD --days 30 --chunk 12
 */

import { HistoricalDataImporter } from './importHistoricalData.js';
import dotenv from 'dotenv';

dotenv.config();

interface CliArgs {
  symbol: string;
  days?: number;
  from?: string;
  to?: string;
  chunk?: number;
}

function parseArgs(): CliArgs {
  const args: CliArgs = { symbol: 'EURUSD' };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    switch(arg) {
      case '--symbol':
      case '-s':
        args.symbol = process.argv[++i];
        break;
      case '--days':
      case '-d':
        args.days = parseInt(process.argv[++i]);
        break;
      case '--from':
        args.from = process.argv[++i];
        break;
      case '--to':
        args.to = process.argv[++i];
        break;
      case '--chunk':
      case '-c':
        args.chunk = parseInt(process.argv[++i]);
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log(`
📥 Historical Data Importer - Dukascopy bi5 Files

Usage:
  npm run import -- [options]

Options:
  --symbol, -s    Symbol to import (e.g., EURUSD, BTCUSD)
  --days, -d      Number of days to import (from today backwards)
  --from          Start date (YYYY-MM-DD)
  --to            End date (YYYY-MM-DD)
  --chunk, -c     Chunk size in hours (default: 1)
  --help, -h      Show this help

Examples:
  # Import last 7 days of EURUSD (1 hour chunks)
  npm run import -- --symbol EURUSD --days 7

  # Import specific date range
  npm run import -- --symbol EURUSD --from 2024-01-01 --to 2024-01-31

  # Import with custom chunk size (12 hours at a time)
  npm run import -- --symbol BTCUSD --days 30 --chunk 12

Supported Symbols:
  Forex: EURUSD, GBPUSD, USDJPY, AUDUSD, etc.
  Crypto: BTCUSD, ETHUSD, etc.
  Stocks: AAPL, TSLA, etc. (if available)
  `);
}

async function main() {
  const args = parseArgs();

  console.log(`
╔════════════════════════════════════════════════╗
║   Historical Data Importer - Dukascopy bi5    ║
╚════════════════════════════════════════════════╝
`);

  const importer = new HistoricalDataImporter();

  let startDate: Date;
  let endDate: Date;

  if (args.from && args.to) {
    // Use explicit date range
    startDate = new Date(args.from);
    endDate = new Date(args.to);
  } else if (args.days) {
    // Use days backwards from now
    endDate = new Date();
    startDate = new Date();
    startDate.setDate(startDate.getDate() - args.days);
  } else {
    // Default: last 7 days
    endDate = new Date();
    startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
  }

  const chunkHours = args.chunk || 1;

  console.log(`📊 Configuration:`);
  console.log(`   Symbol: ${args.symbol}`);
  console.log(`   From: ${startDate.toLocaleDateString()}`);
  console.log(`   To: ${endDate.toLocaleDateString()}`);
  console.log(`   Chunk Size: ${chunkHours} hour(s)`);
  console.log(``);

  // Skip data exists check to avoid holding DB connections during slow Dukascopy fetches
  // (Duplicates will be handled by post-import cleanup script)

  // Start import
  const startTime = Date.now();

  await importer.importDateRange(args.symbol, startDate, endDate, chunkHours);

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`
╔════════════════════════════════════════════════╗
║              Import Complete! 🎉               ║
╚════════════════════════════════════════════════╝

   Duration: ${duration}s
   Symbol: ${args.symbol}

Next Steps:
  1. Refresh materialized views:
     npm run refresh-mvs

  2. Verify data:
     psql $DATABASE_URL -c "SELECT COUNT(*) FROM market_ticks WHERE symbol='${args.symbol}'"

  3. Test API:
     curl "http://localhost:8080/api/candles?symbol=${args.symbol}&timeframe=1h&from=..."
  `);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Import failed:', error);
    process.exit(1);
  });
