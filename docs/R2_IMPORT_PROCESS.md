# R2 Forex Data Import Process - Complete Guide

## Overview
This document describes the repeatable process for importing forex tick data from Dukascopy directly to Cloudflare R2 storage.

## Prerequisites

### 1. Environment Variables
Ensure `.env` file contains R2 credentials:
```bash
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=data-lake
R2_ENDPOINT=https://your_account_id.r2.cloudflarestorage.com
```

### 2. Dependencies
```bash
npm install @aws-sdk/client-s3 dukascopy-node dotenv tslib
```

## Import Scripts

### 1. Direct Import: Dukascopy → R2
**Script:** `src/scripts/import-to-r2.ts`

**Usage:**
```bash
npx tsx src/scripts/import-to-r2.ts <SYMBOL> <START_DATE> <END_DATE> [CHUNK_HOURS]
```

**Examples:**
```bash
# Import one month of data
npx tsx src/scripts/import-to-r2.ts EURUSD 2024-10-01 2024-10-31

# Import with custom chunk size (default is 24 hours)
npx tsx src/scripts/import-to-r2.ts GBPUSD 2024-01-01 2024-12-31 24
```

### 2. Migration Import: PostgreSQL → R2
**Script:** `src/scripts/backfill-r2.ts`

**Usage:**
```bash
npx tsx src/scripts/backfill-r2.ts <SYMBOL> <START_DATE>:<END_DATE>
```

**Example:**
```bash
npx tsx src/scripts/backfill-r2.ts EURUSD 2024-02-01:2024-02-29
```

## Standard Import Process

### Step 1: Import Major Forex Pairs

The 7 major forex pairs to import:
1. EURUSD - Euro/US Dollar
2. GBPUSD - British Pound/US Dollar
3. USDJPY - US Dollar/Japanese Yen
4. USDCHF - US Dollar/Swiss Franc
5. AUDUSD - Australian Dollar/US Dollar
6. USDCAD - US Dollar/Canadian Dollar
7. NZDUSD - New Zealand Dollar/US Dollar

### Step 2: Parallel Import Commands (UPDATED - USE THIS METHOD)

⚠️ **IMPORTANT**: Use the `parallel-import.sh` script to avoid DNS exhaustion issues:

```bash
# RECOMMENDED: Use the parallel import script with proper DNS configuration
./parallel-import.sh major-pairs 2024-01-01 2024-12-31

# Fill known gaps in the data
./parallel-import.sh fill-gaps

# Import single symbol
./parallel-import.sh single EURUSD 2024-11-01 2024-11-30
```

**Why use the script?**
- Sets `UV_THREADPOOL_SIZE=128` to handle parallel DNS lookups (default is only 4)
- Includes proper retry logic for network errors
- Maintains full parallelization without DNS exhaustion
- Automatically handles all major forex pairs

**Manual parallel imports (if needed):**
```bash
# MUST set UV_THREADPOOL_SIZE first to avoid DNS issues!
export UV_THREADPOOL_SIZE=128

# Then run imports in parallel
npx tsx src/scripts/import-to-r2.ts GBPUSD 2024-10-15 2024-11-15 &
npx tsx src/scripts/import-to-r2.ts USDJPY 2024-10-15 2024-11-15 &
npx tsx src/scripts/import-to-r2.ts USDCHF 2024-10-15 2024-11-15 &
npx tsx src/scripts/import-to-r2.ts AUDUSD 2024-10-15 2024-11-15 &
npx tsx src/scripts/import-to-r2.ts USDCAD 2024-10-15 2024-11-15 &
npx tsx src/scripts/import-to-r2.ts NZDUSD 2024-10-15 2024-11-15 &
```

### Step 3: Monitor Progress

Check import status:
```bash
# Check running processes
ps aux | grep "import-to-r2"

# Monitor specific process output
tail -f nohup.out  # if using nohup
```

## Data Structure in R2

Files are stored with this naming convention:
```
ticks/{SYMBOL}/{YYYY}/{MM}/{DD}/part-{timestamp}.json
```

Example:
```
ticks/EURUSD/2024/10/15/part-1763176340191.json
```

## Data Format

Each JSON file contains an array of ticks:
```json
[
  {
    "timestamp": 1728950400.207,  // Unix timestamp with milliseconds
    "bid": 0.67248,              // Bid price
    "ask": 0.67256               // Ask price
  },
  ...
]
```

## Expected Data Volumes

Per symbol per day:
- **Typical:** 50,000 - 100,000 ticks
- **File size:** 2-4 MB per day
- **Monthly:** ~1.5-3M ticks (~60-120 MB)

Import speeds:
- **Fetching from Dukascopy:** ~1-2 minutes per day
- **Upload to R2:** <1 second per file
- **Parallel processing:** 6 pairs simultaneously recommended

## Materialization Process

After importing ticks to R2, materialize them into candles:

### 1. Materialize to candles_5m table
```bash
npx tsx src/scripts/materialize-candles.ts EURUSD 2024-10-01 2024-10-31
```

### 2. Create/refresh materialized views
```sql
-- After materializing to candles_5m, refresh views
REFRESH MATERIALIZED VIEW CONCURRENTLY candles_15m;
REFRESH MATERIALIZED VIEW CONCURRENTLY candles_1h;
REFRESH MATERIALIZED VIEW CONCURRENTLY candles_4h;
REFRESH MATERIALIZED VIEW CONCURRENTLY candles_12h;
```

## Troubleshooting

### Common Issues

1. **Date format error**
   - Use spaces, not colons: `2024-10-15 2024-11-15` ✓
   - Not: `2024-10-15:2024-11-15` ✗

2. **Missing dependencies**
   ```bash
   npm install tslib @aws-sdk/client-s3 dukascopy-node
   ```

3. **R2 credentials not loaded**
   - Ensure `dotenv.config()` is called in script
   - Check `.env` file exists and has R2 credentials

4. **Stack overflow in materialization**
   - Fixed by avoiding spread operator with large arrays
   - Use loop instead: `for (const tick of ticks) { allTicks.push(tick); }`

5. **TimescaleDB restore mode stuck**
   - Drop and recreate hypertable if stuck
   ```sql
   DROP TABLE IF EXISTS candles_5m CASCADE;
   -- Then recreate with original schema
   ```

6. **DNS exhaustion errors (FIXED in latest version)**
   - Symptom: `getaddrinfo ENOTFOUND datafeed.dukascopy.com`
   - Cause: Node.js default UV_THREADPOOL_SIZE=4 limits DNS lookups
   - Solution: Use `parallel-import.sh` script or set `export UV_THREADPOOL_SIZE=128`
   - Script now includes proper network retry logic (30-second wait + retry)

7. **"Unknown error" crashes on certain dates (FIXED in latest version)**
   - Symptom: Import fails with "Unknown error" after 3-4 chunks, always on specific dates (e.g., Jan 3-5, 2024)
   - Cause: Dukascopy's BufferFetcher throws errors for unavailable data, but `error.message` is just "Unknown error"
   - Root issue: Error handling only checked `error.message`, not `error.stack` which contained "BufferFetcher"
   - Solution: Enhanced error handling in `import-to-r2.ts` line 169:
     ```typescript
     // OLD (broken):
     } else if (error.message?.includes('BufferFetcher')) {

     // NEW (fixed):
     } else if (error.message?.includes('BufferFetcher') || error.stack?.includes('BufferFetcher')) {
     ```
   - Impact: Imports now gracefully skip problematic dates instead of crashing
   - Enhanced logging shows full error details (message, name, code, stack) for debugging

8. **Import processes hanging indefinitely (FIXED in latest version)**
   - Symptom: Import processes run for 18+ hours without completing, stuck in "SN" (sleeping) state
   - Last log message: "🔍 Fetching from Dukascopy..." with no further progress
   - Cause: `failAfterRetryCount: false` in `getHistoricalRates` config causes infinite retry loops
   - When Dukascopy has persistent issues fetching certain dates, it retries forever (every 10 seconds)
   - Root issue: Configured in `import-to-r2.ts` lines 80 and 141
   - Solution: Changed to `failAfterRetryCount: true` to enforce retry limits
     ```typescript
     // OLD (broken):
     failAfterRetryCount: false  // Retries forever!

     // NEW (fixed):
     failAfterRetryCount: true   // Fails after 10 retries (100 seconds)
     ```
   - Impact: Processes now fail fast after 10 retries, allowing error handling to catch and skip problematic chunks
   - Debugging method: Check process state with `ps -p <PID> -o pid,stat,wchan,etime` - "SN" status for hours indicates infinite retry
   - Total time wasted before fix: 18+ hours per stuck process

## Verification

### Check R2 uploads
```bash
# Using AWS CLI (configured for R2)
aws s3 ls s3://data-lake/ticks/EURUSD/2024/10/ --endpoint-url=$R2_ENDPOINT

# Or check programmatically
npx tsx -e "
import { getR2Client } from './src/services/r2Client.js';
const client = getR2Client();
const files = await client.listTickFiles('EURUSD', new Date('2024-10-15'));
console.log(files);
"
```

### Check candles in database
```sql
-- Check candle count
SELECT symbol, COUNT(*) as candle_count,
       MIN(time)::date as first_date,
       MAX(time)::date as last_date
FROM candles_5m
GROUP BY symbol
ORDER BY symbol;
```

## Quick Reference

### Import last 30 days for all major pairs
```bash
#!/bin/bash
# Save as import-major-pairs.sh

END_DATE=$(date +%Y-%m-%d)
START_DATE=$(date -d "30 days ago" +%Y-%m-%d)  # Linux
# START_DATE=$(date -v-30d +%Y-%m-%d)  # macOS

PAIRS=("EURUSD" "GBPUSD" "USDJPY" "USDCHF" "AUDUSD" "USDCAD" "NZDUSD")

for pair in "${PAIRS[@]}"; do
  echo "Starting import for $pair from $START_DATE to $END_DATE"
  npx tsx src/scripts/import-to-r2.ts "$pair" "$START_DATE" "$END_DATE" &
done

echo "All imports started. Check progress with: ps aux | grep import-to-r2"
```

## Summary Statistics from Recent Import

- **EURUSD**: 15.8M ticks (Feb 2024 - Jan 2025)
- **GBPUSD**: 1.8M ticks (Oct-Nov 2024)
- **USDJPY**: 2.7M ticks (Oct-Nov 2024)
- **USDCHF**: 1.1M ticks (Oct-Nov 2024)
- **AUDUSD**: 1.1M ticks (Oct-Nov 2024)
- **USDCAD**: 1.4M ticks (Oct-Nov 2024)
- **NZDUSD**: 1.0M ticks (Oct-Nov 2024)

**Total:** ~24.9M ticks across 7 major pairs

## Cost Comparison

- **R2 Storage**: $0.015/GB/month
- **PostgreSQL/TimescaleDB**: $0.15/GB/month
- **Savings**: 10x cost reduction

For 25M ticks (~1GB):
- R2: ~$0.015/month
- Database: ~$0.15/month

## Notes

- Always run imports in parallel for efficiency
- Dukascopy has rate limits; the script handles retries automatically
- Weekend dates are automatically skipped (forex markets closed)
- Each day's data is stored as a separate JSON file in R2
- The materialization process can handle millions of ticks efficiently after the stack overflow fix