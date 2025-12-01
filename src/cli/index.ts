#!/usr/bin/env tsx
/**
 * Market Data CLI - Unified command-line interface for data operations
 *
 * Commands:
 *   import     - Import tick data from Dukascopy to R2
 *   materialize - Materialize R2 candles to PostgreSQL
 *   migrate    - Convert R2 ticks to candles
 *   backfill   - Backfill missing Fridays
 *   analyze    - Analyze R2 bucket statistics
 *
 * Usage:
 *   npx tsx src/cli/index.ts <command> [args...]
 *
 * Examples:
 *   npx tsx src/cli/index.ts import EURUSD 2024-01-01 2024-12-31
 *   npx tsx src/cli/index.ts materialize EURUSD 2024-01-01 2024-12-31
 *   npx tsx src/cli/index.ts migrate EURUSD 2024-01-01 2024-12-31
 *   npx tsx src/cli/index.ts backfill EURUSD 2024-01-01 2024-12-31 --dry-run
 *   npx tsx src/cli/index.ts analyze --sample
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COMMANDS: Record<string, string> = {
  import: 'import.ts',
  materialize: 'materialize.ts',
  migrate: 'migrate.ts',
  backfill: 'backfill.ts',
  analyze: 'analyze.ts'
};

function showUsage(): void {
  console.log(`
Market Data CLI - Unified command-line interface for data operations

Usage:
  npx tsx src/cli/index.ts <command> [args...]

Commands:
  import      Import tick data from Dukascopy to R2
              Usage: import <SYMBOL> <START_DATE> <END_DATE> [CHUNK_HOURS] [DELAY_SECONDS]

  materialize Materialize R2 candles to PostgreSQL
              Usage: materialize <SYMBOL> <START_DATE> [END_DATE] [--dry-run]

  migrate     Convert R2 ticks to candles
              Usage: migrate <SYMBOL> <START_DATE> <END_DATE> [--dry-run] [--delete-ticks]

  backfill    Backfill missing Fridays
              Usage: backfill <SYMBOL> <START_DATE> <END_DATE> [--dry-run]

  analyze     Analyze R2 bucket statistics
              Usage: analyze [--sample] [--output=<file>]

Examples:
  npx tsx src/cli/index.ts import EURUSD 2024-01-01 2024-12-31
  npx tsx src/cli/index.ts materialize EURUSD 2024-01-01 2024-12-31
  npx tsx src/cli/index.ts migrate EURUSD 2024-01-01 2024-12-31
  npx tsx src/cli/index.ts backfill EURUSD 2024-01-01 2024-12-31 --dry-run
  npx tsx src/cli/index.ts analyze --sample
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showUsage();
    process.exit(0);
  }

  const command = args[0].toLowerCase();
  const commandArgs = args.slice(1);

  if (!COMMANDS[command]) {
    console.error(`❌ Unknown command: ${command}`);
    console.error(`Available commands: ${Object.keys(COMMANDS).join(', ')}`);
    process.exit(1);
  }

  const commandFile = path.join(__dirname, 'commands', COMMANDS[command]);

  // Spawn the command as a subprocess
  const child = spawn('npx', ['tsx', commandFile, ...commandArgs], {
    stdio: 'inherit',
    cwd: process.cwd()
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });

  child.on('error', (error) => {
    console.error(`❌ Failed to execute command: ${error.message}`);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('CLI error:', err);
  process.exit(1);
});
