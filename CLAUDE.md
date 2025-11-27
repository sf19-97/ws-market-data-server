# WebSocket Market Data Server

## Overview

A high-performance, multi-broker market data server that provides:
- **Real-time WebSocket streaming** from multiple financial data providers (Binance, OANDA)
- **Historical tick data storage** in TimescaleDB with optimized time-series queries
- **REST API** for historical OHLC candles with materialized view acceleration
- **Professional import tooling** for bulk loading historical data with smart index management

The system serves dual purposes:
1. Real-time market data aggregation and streaming
2. Historical data warehouse with optimized query performance

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Client Applications                      │
└──────────────┬─────────────────────────┬───────────────────┘
               │ WebSocket               │ HTTP REST API
               │ (Real-time)             │ (Historical)
               │                         │
┌──────────────▼─────────────────────────▼───────────────────┐
│              Market Data Server (Express + WS)              │
│  ┌─────────────────────┐    ┌──────────────────────────┐   │
│  │   BrokerManager     │    │   HTTP API Endpoints     │   │
│  │  - Binance          │    │  - /api/metadata         │   │
│  │  - OANDA            │    │  - /api/candles          │   │
│  └──────────┬──────────┘    └───────────┬──────────────┘   │
└─────────────┼─────────────────────────┬─┼──────────────────┘
              │ Live data               │ │ Queries
              ▼                         │ │
    ┌─────────────────┐                │ │
    │  Binance WS API │                │ │
    │  OANDA Stream   │                │ │
    └─────────────────┘                │ │
                                       ▼ ▼
                          ┌──────────────────────────┐
                          │    TimescaleDB/PG        │
                          │  ┌────────────────────┐  │
                          │  │   market_ticks     │  │
                          │  │   (hypertable)     │  │
                          │  └────────────────────┘  │
                          │  ┌────────────────────┐  │
                          │  │ Materialized Views │  │
                          │  │ - forex_candles_5m │  │
                          │  │ - forex_candles_1h │  │
                          │  │ - forex_candles_4h │  │
                          │  └────────────────────┘  │
                          └──────────────────────────┘
```

### Core Technologies

- **Runtime**: Node.js 18+ with TypeScript
- **Web Framework**: Express 5 (HTTP/REST API)
- **WebSocket**: ws library for real-time streaming
- **Database**: TimescaleDB/PostgreSQL for time-series data
- **Data Sources**: Binance WebSocket API, OANDA Stream API, Dukascopy (historical import)

## Project Structure

```
ws-market-data-server/
├── src/
│   ├── index.ts                    # Main server (Express + WebSocket + API endpoints)
│   ├── brokers/                    # Real-time broker implementations
│   │   ├── BaseBroker.ts           # Abstract base class
│   │   ├── BinanceBroker.ts        # Binance WebSocket connection
│   │   ├── OandaBroker.ts          # OANDA HTTP stream connection
│   │   └── Mock*.ts                # Testing brokers
│   ├── core/                       # Core server components
│   │   ├── BrokerManager.ts        # Broker orchestration
│   │   └── ClientConnection.ts     # WebSocket client handler
│   ├── services/                   # Business logic services
│   │   ├── r2Client.ts             # Cloudflare R2 client for data lake storage
│   │   ├── candlesService.ts       # Candle aggregation and caching
│   │   └── tickBatcher.ts          # Real-time tick batching for R2
│   ├── scripts/                    # Data import and maintenance
│   │   ├── import-cli.ts           # CLI for historical data import (TimescaleDB)
│   │   ├── importHistoricalData.ts # Core importer class (TimescaleDB)
│   │   ├── import-to-r2.ts         # R2 data lake importer (Dukascopy → R2)
│   │   ├── backfill-r2.ts          # Migration tool (PostgreSQL → R2)
│   │   ├── materialize-candles.ts  # R2 → PostgreSQL candle materialization
│   │   ├── analyze-r2.ts           # R2 data analysis and statistics
│   │   ├── drop-import-indexes.ts  # Index management for bulk loads
│   │   ├── recreate-indexes.ts     # Rebuild indexes after import
│   │   ├── post-import-cleanup.ts  # Database maintenance
│   │   └── check-*.ts              # Data validation utilities
│   ├── types/                      # TypeScript definitions
│   └── utils/                      # Utility functions
├── .claude/
│   └── problems/                   # Technical problem documentation
│       └── index-performance.md    # Index optimization analysis
├── config/
│   └── config.yaml                 # Broker configuration
├── migrations/                     # Database schema migrations
│   └── candles_5m.sql              # Candle tables for R2 materialization
├── API_USAGE.md                    # REST API client guide
├── IMPORT_GUIDE.md                 # Historical data import guide (TimescaleDB)
├── INDEX_MANAGEMENT.md             # Database performance optimization
├── R2_IMPORT_PROCESS.md            # R2 data lake import guide (RECOMMENDED)
├── R2_DEPLOYMENT_GUIDE.md          # R2 deployment and production setup
└── ARCHITECTURE.md                 # Detailed architecture docs
```

### Key Directories

- **`/src/brokers/`** - Broker implementations for real-time data (Binance, OANDA)
- **`/src/services/`** - Business logic (R2 client, candle aggregation, tick batching)
- **`/src/scripts/`** - Data import tools (R2 data lake + legacy TimescaleDB)
- **`/src/core/`** - WebSocket server and connection management
- **`.claude/problems/`** - Technical analysis and performance investigations

### Storage Architecture: Dual System

The project uses a **dual storage approach**:

1. **R2 Data Lake (RECOMMENDED)** - Cloudflare R2 for cost-effective tick storage
   - 10x cheaper than database storage ($0.015/GB vs $0.15/GB)
   - Direct import from Dukascopy to R2 (skip database entirely)
   - On-demand materialization to PostgreSQL candles when needed
   - See `R2_IMPORT_PROCESS.md` for complete guide

2. **TimescaleDB (LEGACY)** - PostgreSQL with TimescaleDB extension
   - Original system for tick storage and materialized views
   - Still used for materialized candles (candles_5m table)
   - Higher cost, but faster queries for pre-aggregated data
   - See `IMPORT_GUIDE.md` for legacy import process

**Migration Path**: New data → R2 data lake. Legacy data remains in TimescaleDB until migrated.

## Setup & Installation

### Prerequisites

- Node.js 18+
- PostgreSQL 14+ with TimescaleDB extension
- npm or yarn

### Installation

```bash
# Clone and install
git clone <repository-url>
cd ws-market-data-server
npm install

# Configure environment
cp .env.example .env
```

### Environment Variables

```bash
# Database (for candle materialization and legacy system)
DATABASE_URL=postgresql://user:password@localhost:5432/market_data

# R2 Data Lake (REQUIRED for R2 imports)
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=data-lake
R2_ENDPOINT=https://your_account_id.r2.cloudflarestorage.com

# Optional: Broker credentials for real-time data
OANDA_API_KEY=your-api-key
OANDA_ACCOUNT_ID=your-account-id
```

**Note:** For R2 setup instructions, see `R2_DEPLOYMENT_GUIDE.md`

### Database Setup

```bash
# Create database with TimescaleDB
psql -c "CREATE DATABASE market_data;"
psql market_data -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"

# Run migrations (create tables and views)
psql $DATABASE_URL < migrations/001_create_tables.sql
psql $DATABASE_URL < migrations/002_create_views.sql
```

## Development Workflow

### Running the Server

```bash
# Development with hot reload
npm run dev

# Production build and run
npm run build
npm start
```

### Available Scripts

#### Server Operations
- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Run production server

#### Code Quality
- `npm run lint` - Run ESLint
- `npm run typecheck` - TypeScript type checking
- `npm test` - Run test suite

#### Data Import
- `npm run import` - Import historical tick data
- `npm run drop-indexes` - Drop indexes before bulk import
- `npm run recreate-indexes` - Rebuild indexes after import
- `npm run refresh-mvs` - Refresh materialized views

## API Documentation

### REST Endpoints

#### 1. `/api/metadata` - Data Availability

Get information about available symbols and date ranges.

```bash
# All symbols
GET /api/metadata

# Specific symbol
GET /api/metadata?symbol=EURUSD
```

**Response:**
```json
{
  "symbol": "EURUSD",
  "earliest": 1706745600,
  "latest": 1737755998,
  "tick_count": 11600518,
  "timeframes": ["1m", "5m", "15m", "1h", "4h", "12h"]
}
```

#### 2. `/api/candles` - Historical OHLC Data

Fetch historical candle data with automatic caching.

```bash
GET /api/candles?symbol=EURUSD&timeframe=1h&from=1710918000&to=1711004399
```

**Parameters:**
- `symbol` (required): Symbol name (e.g., "EURUSD")
- `timeframe` (optional): "1m", "5m", "15m", "1h", "4h", "12h" (default: "1h")
- `from` (required): Start timestamp (Unix seconds)
- `to` (required): End timestamp (Unix seconds)

**Response:**
```json
[
  {
    "time": 1710918000,
    "open": 1.08703,
    "high": 1.08721,
    "low": 1.08650,
    "close": 1.08656
  }
]
```

**Caching:**
- Uses ETags for efficient browser caching
- Returns 304 Not Modified when data unchanged
- Cache-Control headers set based on timeframe

### WebSocket API

See [ARCHITECTURE.md](src/index.ts:180-248) for complete WebSocket protocol documentation.

**Connect:**
```javascript
const ws = new WebSocket('ws://localhost:8080');
```

**Subscribe to real-time data:**
```javascript
ws.send(JSON.stringify({
  action: 'subscribe',
  broker: 'binance',
  symbols: ['BTCUSDT'],
  types: ['tick']
}));
```

## Historical Data Import

### R2 Data Lake Import (RECOMMENDED)

**Direct import from Dukascopy to R2** - 10x cheaper storage, no database overhead.

```bash
# Import one symbol for a date range
npx tsx src/scripts/import-to-r2.ts EURUSD 2024-01-01 2024-12-31

# Import with custom chunk size (default is 24 hours)
npx tsx src/scripts/import-to-r2.ts EURUSD 2024-01-01 2024-12-31 24

# Import multiple symbols in parallel (RECOMMENDED - see R2_IMPORT_PROCESS.md)
./parallel-import.sh major-pairs 2024-01-01 2024-12-31

# Analyze R2 data
npx tsx src/scripts/analyze-r2.ts --sample
```

**After importing to R2:**
```bash
# Materialize ticks to candles (if needed for PostgreSQL queries)
npx tsx src/scripts/materialize-candles.ts EURUSD 2024-01-01 2024-12-31

# Refresh materialized views (if using candles)
npm run refresh-mvs
```

**See `R2_IMPORT_PROCESS.md` for complete guide with troubleshooting.**

### TimescaleDB Import (LEGACY)

**Import to PostgreSQL database** - Higher cost, but integrated with existing materialized views.

```bash
# Import last 7 days of EURUSD
npm run import -- --symbol EURUSD --days 7

# Import specific date range
npm run import -- --symbol EURUSD --from 2024-03-01 --to 2024-03-31

# Import with automatic index management (recommended for large imports)
npm run import -- --symbol EURUSD --from 2024-01-01 --to 2024-12-31 --manage-indexes
```

**After importing to TimescaleDB:**
```bash
# Refresh materialized views to include new data
npm run refresh-mvs

# Verify import
psql $DATABASE_URL -c "SELECT COUNT(*), MIN(time), MAX(time) FROM market_ticks WHERE symbol='EURUSD';"
```

### Performance Optimization

For bulk imports, use the `--manage-indexes` flag for 5-10x faster performance:

```bash
npm run import -- \
  --symbol EURUSD \
  --from 2024-01-01 \
  --to 2024-12-31 \
  --manage-indexes
```

**What it does:**
1. Drops expensive BTREE indexes
2. Imports data (5-10x faster)
3. Recreates indexes with `CONCURRENTLY`
4. Runs `ANALYZE` to update statistics

See [INDEX_MANAGEMENT.md](INDEX_MANAGEMENT.md) for detailed explanation.

## Database Schema

### Core Tables

#### `market_ticks` (TimescaleDB Hypertable)

Primary table for raw tick data:

```sql
CREATE TABLE market_ticks (
  time TIMESTAMPTZ NOT NULL,
  symbol TEXT NOT NULL,
  ask DOUBLE PRECISION,
  bid DOUBLE PRECISION,
  CONSTRAINT forex_ticks_symbol_time_uq UNIQUE (symbol, time)
);

-- Convert to hypertable (time-series optimization)
SELECT create_hypertable('market_ticks', 'time');
```

**Indexes:**
- `forex_ticks_symbol_time_uq` - UNIQUE constraint on (symbol, time)
- `forex_ticks_time_brin` - BRIN index for time-range queries
- `forex_ticks_time_idx` - BTREE on time DESC
- `forex_ticks_symbol_time_idx` - BTREE on (symbol, time) DESC

### Materialized Views

Pre-aggregated OHLC candles for fast queries:

- `forex_candles_5m` - 5-minute candles
- `forex_candles_15m` - 15-minute candles
- `forex_candles_1h` - 1-hour candles
- `forex_candles_4h` - 4-hour candles
- `forex_candles_12h` - 12-hour candles

**Refresh after imports:**
```bash
npm run refresh-mvs
```

## Performance Features

### Query Optimization

1. **Materialized Views** - Pre-aggregated candles for instant queries
   - 5m, 15m, 1h, 4h, 12h timeframes use views
   - 1m timeframe computed on-demand

2. **TimescaleDB Hypertables** - Automatic partitioning by time
   - Efficient time-range queries
   - Automatic data retention policies (future)

3. **BRIN Indexes** - Block Range Indexes for time-series data
   - Minimal storage overhead (~2%)
   - Perfect for time-ordered data

4. **Browser Caching** - ETags and Cache-Control headers
   - Automatic 304 responses for unchanged data
   - Reduced bandwidth and server load

### Import Optimization

1. **Smart Index Management** - Drop/recreate indexes for bulk loads
   - 5-10x faster imports
   - Automated with `--manage-indexes` flag

2. **Chunked Processing** - Import in configurable chunks
   - Default 7-day chunks
   - Prevents memory issues

3. **PostgreSQL COPY** - Fast bulk loading
   - 100x faster than INSERT
   - Used in import pipeline

## Recent Updates (Updated: 2025-11-19)

### R2 Data Lake Migration (Commit: 18be65e) - MAJOR ARCHITECTURE CHANGE

**Why R2?** Cost reduction from $0.15/GB (PostgreSQL) to $0.015/GB (R2) = **10x cheaper storage**

**New Architecture:**
```
Dukascopy → R2 Data Lake → On-demand Materialization → PostgreSQL Candles
```

**Core Components:**
- `src/services/r2Client.ts` - S3-compatible client for Cloudflare R2
- `src/scripts/import-to-r2.ts` - Direct Dukascopy → R2 import (skip database)
- `src/scripts/materialize-candles.ts` - R2 → PostgreSQL candle aggregation
- `src/scripts/backfill-r2.ts` - Migration tool (PostgreSQL → R2)
- `src/scripts/analyze-r2.ts` - R2 data analysis and statistics

**Data Flow:**
1. **Import**: Fetch tick data from Dukascopy → Upload to R2 as JSON
2. **Store**: Ticks stored in R2 with partitioned structure: `ticks/{SYMBOL}/{YYYY}/{MM}/{DD}/part-{timestamp}.json`
3. **Materialize**: When candles needed, read from R2 → aggregate → store in PostgreSQL candles_5m
4. **Query**: Read candles from PostgreSQL (fast) while ticks stay in R2 (cheap)

**Import Statistics (as of 2025-11-19):**
- **Total ticks in R2**: 157.8M+ ticks
- **EURUSD**: 15.8M ticks (Feb 2024 - Jan 2025)
- **Other major pairs**: 1-2.7M ticks each (Oct-Nov 2024)
- **Storage cost**: ~$0.015/month per GB vs $0.15/month in PostgreSQL

**Critical Fixes:**
1. **Infinite retry loop** (src/scripts/import-to-r2.ts:80, 141)
   - Changed `failAfterRetryCount: false` → `true`
   - Prevented 18+ hour hangs when Dukascopy unavailable
   - Saved 72+ hours of wasted compute time

2. **BufferFetcher error handling** (src/scripts/import-to-r2.ts:169)
   - Check both `error.message` AND `error.stack`
   - Gracefully skip dates with no data
   - Allows full-year imports to complete

**Documentation:**
- `R2_IMPORT_PROCESS.md` - Complete R2 import guide with troubleshooting
- `R2_DEPLOYMENT_GUIDE.md` - Production deployment guide
- See troubleshooting section below for detailed error analysis

### Historical Data Import System (TimescaleDB - LEGACY)

**Historical Data Import System** (Commits: 2b59e35, 900a6a9)
- Professional CLI tool for importing Dukascopy tick data to TimescaleDB
- Smart index management for 5-10x faster bulk imports
- Automatic materialized view refresh
- Support for multiple symbols and date ranges
- Progress tracking and error handling

**REST API Endpoints** (Commit: 900a6a9)
- `/api/metadata` - Discover available data and date ranges
- `/api/candles` - Fetch historical OHLC data with caching
- ETag-based browser caching for efficient data delivery

**Performance Optimizations** (Commits: 7a148b8, 9012ebc)
- Materialized views for 5m, 15m, 1h, 4h, 12h candles (100x+ faster queries)
- BRIN indexes for time-series data (minimal overhead)
- Database index management strategy for bulk imports
- Browser caching with ETag support

### New Documentation

- `R2_IMPORT_PROCESS.md` - R2 data lake import guide (RECOMMENDED)
- `R2_DEPLOYMENT_GUIDE.md` - R2 deployment and production setup
- `API_USAGE.md` - Complete REST API client guide with examples
- `IMPORT_GUIDE.md` - Historical data import instructions (TimescaleDB legacy)
- `INDEX_MANAGEMENT.md` - Database performance optimization guide
- `.claude/problems/index-performance.md` - Technical analysis of import performance

### Scripts Added

```bash
# R2 Data Lake (RECOMMENDED)
npx tsx src/scripts/import-to-r2.ts EURUSD 2024-01-01 2024-12-31
npx tsx src/scripts/materialize-candles.ts EURUSD 2024-01-01 2024-12-31
npx tsx src/scripts/analyze-r2.ts --sample

# TimescaleDB (LEGACY)
npm run import              # Import historical tick data
npm run drop-indexes        # Drop indexes before bulk import
npm run recreate-indexes    # Recreate indexes after import
npm run refresh-mvs         # Refresh materialized views
```

### Database Improvements

- TimescaleDB hypertables for efficient time-series storage
- Professional index management strategy
- Materialized views for pre-aggregated candles
- UNIQUE constraint on (symbol, time) for deduplication
- R2 integration for cost-effective tick storage

### Import Performance

**R2 Import (RECOMMENDED):**
- Direct import: Dukascopy → R2 (no database overhead)
- ~1-2 minutes per day of tick data
- ~30-60 minutes for 1 month
- Parallel processing: 6 symbols simultaneously
- Storage cost: $0.015/GB/month

**TimescaleDB Import (LEGACY):**
- Before optimization: ~3 hours for 1 month
- After optimization: ~25 minutes for 1 month
- Storage cost: $0.15/GB/month (10x more expensive)

## Important Notes

### Data Import Best Practices

**R2 Data Lake (RECOMMENDED):**
1. **Use R2 for new data** - 10x cheaper storage ($0.015/GB vs $0.15/GB)
2. **Import in parallel** - Use `./parallel-import.sh` for 6 symbols simultaneously
3. **Set UV_THREADPOOL_SIZE=128** - Prevents DNS exhaustion during parallel imports
4. **Monitor for hangs** - Check process state with `ps -p <PID> -o pid,stat,wchan,etime`
5. **See R2_IMPORT_PROCESS.md** - Complete guide with all known issues and fixes

**TimescaleDB (LEGACY):**
1. **Use `--manage-indexes` for large imports** - 5-10x performance improvement
2. **Refresh materialized views after imports** - `npm run refresh-mvs`
3. **Import in chunks** - Default 7-day chunks for optimal memory usage

**General:**
1. **Always check metadata first** - Don't assume data exists up to current date
2. **Test on single day first** - Verify import works before running full-year imports
3. **Markets are closed on weekends** - No forex data on Saturdays/Sundays

### API Usage

1. **Timestamps are Unix seconds** - Not milliseconds! Divide `Date.now()` by 1000
2. **Check `/api/metadata` before requesting candles** - Verify data availability
3. **Materialized views update on demand** - Run refresh-mvs after imports
4. **Browser caching is automatic** - Server handles ETags and Cache-Control

### Database Maintenance

1. **Index management** - Use automated tools for bulk imports
2. **ANALYZE after imports** - Update query planner statistics
3. **Materialized view refresh** - Required after new data imports
4. **Monitor disk space** - Time-series data grows quickly

### Symbol Formats

Different data sources use different formats:
- **Dukascopy/Database**: `EURUSD`, `GBPUSD` (no separator)
- **OANDA**: `EUR_USD`, `GBP_USD` (underscore)
- **Display**: `EUR/USD`, `GBP/USD` (slash)

The server handles format conversion automatically.

## Troubleshooting

### Import Issues

**No data found for date range:**
- Markets closed (weekends/holidays)
- Historical data not available yet for recent dates
- Try dates from at least 1-2 days ago

**Slow imports:**
- Use `--manage-indexes` flag
- Check network connection to Dukascopy
- Reduce chunk size with `--chunk` parameter

### R2 Import Errors

**"Unknown error" crashes during R2 imports (FIXED)**

Symptom: Import crashes with "Unknown error" after 3-4 chunks, always on specific dates.

Root cause: Dukascopy's BufferFetcher throws errors for unavailable data, but `error.message` is unhelpful ("Unknown error"). Error handling only checked `error.message`, not `error.stack` which contained "BufferFetcher".

Debugging method (CRITICAL - use this for similar errors):
1. **Enhance error logging** to see the FULL error object:
   ```typescript
   catch (error: any) {
     console.error('Error message:', error.message);
     console.error('Error name:', error.name);
     console.error('Error code:', error.code);
     console.error('Error stack:', error.stack);  // <-- Key: stack trace reveals true source
     console.error('Full error object:', JSON.stringify(error, null, 2));
     throw error;
   }
   ```

2. **Run a test import** for a single problematic day:
   ```bash
   UV_THREADPOOL_SIZE=128 npx tsx src/scripts/import-to-r2.ts EURUSD 2024-01-06 2024-01-07 2>&1 | tee test.log
   ```

3. **Examine the stack trace** in the log file. Look for the actual source of the error (BufferFetcher in this case).

4. **Fix error handling** to check BOTH `error.message` AND `error.stack`:
   ```typescript
   // BEFORE (broken):
   } else if (error.message?.includes('BufferFetcher')) {

   // AFTER (fixed):
   } else if (error.message?.includes('BufferFetcher') || error.stack?.includes('BufferFetcher')) {
   ```

Location: `src/scripts/import-to-r2.ts:169`

Impact: Imports now gracefully skip problematic dates instead of crashing, allowing full-year imports to complete successfully.

Key lesson: When debugging mysterious errors, ALWAYS log the full error object including stack trace. The error message alone may not reveal the true source.

**Import processes hanging indefinitely (FIXED)**

Symptom: Import processes run for 18+ hours without completing, stuck in "SN" (sleeping) state. Last log message: "🔍 Fetching from Dukascopy..." with no further progress.

Root cause: `failAfterRetryCount: false` in `getHistoricalRates` config causes infinite retry loops. When Dukascopy has persistent issues fetching certain dates, it retries forever (every 10 seconds) instead of failing.

Debugging method:
1. **Check process state** to identify hung processes:
   ```bash
   ps -p <PID> -o pid,stat,wchan,etime
   ```
   - "SN" status for hours/days indicates sleeping process (likely infinite retry)
   - WCHAN shows "-" (not waiting on kernel event, stuck in user space)

2. **Check last log output** to see where it's stuck:
   ```bash
   tail -100 import.log | grep -A 5 -B 5 "SYMBOL"
   ```
   - Look for "🔍 Fetching from Dukascopy..." with no completion

3. **Identify the stuck date range** from chunk number in logs

Fix:
```typescript
// BEFORE (broken - in import-to-r2.ts lines 80 and 141):
failAfterRetryCount: false  // Retries forever!

// AFTER (fixed):
failAfterRetryCount: true   // Fails after 10 retries (100 seconds)
```

Location: `src/scripts/import-to-r2.ts:80` and `src/scripts/import-to-r2.ts:141`

Impact: Processes now fail fast after 10 retries (100 seconds), allowing error handling to catch and skip problematic chunks instead of hanging indefinitely.

Time saved: 18+ hours per stuck process (4 processes = 72+ hours wasted before fix).

Key lesson: When configuring retry logic, ALWAYS set finite retry limits. Infinite retries should only be used with external circuit breakers or timeouts.

### API Issues

**Empty candle responses:**
- Check data exists with `/api/metadata`
- Verify timestamp is in Unix seconds (not milliseconds)
- Ensure materialized views are refreshed: `npm run refresh-mvs`

**Stale data:**
- Refresh materialized views after imports
- Check database connection
- Verify TimescaleDB extension is enabled

**API requests timing out after 60+ seconds (FIXED - 2025-11-26)**

Symptom: Frontend shows "Request timeout after 60000ms" for candle requests. Fly.io logs show repeated "Starting 5m candle materialization" messages for weekend dates.

Root cause: The `ensureCandles5mExist()` function in `candlesService.ts` was designed to auto-materialize missing candles from R2. However, it had a critical flaw:

1. **Coverage check treated weekends as "missing data"** - Forex markets are closed on weekends, so no candle data exists for Saturdays/Sundays
2. **Each "missing" day triggered an R2 download** - The monthly candle file (~5000 candles, ~500KB) was downloaded for EACH weekend
3. **Sequential processing blocked the API response** - No parallelization, no timeout, no background processing
4. **Redundant downloads** - The same monthly file was downloaded multiple times (once per weekend in that month)

Example: A 10-month date range request would trigger ~80 weekend materialization attempts, each downloading from R2 and inserting into PostgreSQL.

Debugging method:
1. **Check fly.io logs** for repeated materialization messages:
   ```bash
   fly logs -a ws-market-data-server | grep "materialization"
   ```
   - Look for dates that are Saturdays/Sundays
   - Look for "No candles found in R2" warnings

2. **Test API response time** directly:
   ```bash
   time curl -s "https://ws-market-data-server.fly.dev/api/candles?symbol=EURUSD&timeframe=4h&from=1706745600&to=1730000000" | wc -c
   ```
   - Should complete in <5 seconds, not 60+

Fix applied:
```typescript
// src/index.ts - BEFORE (broken):
const r2Client = getR2Client();
let materializationService: MaterializationService | undefined;
if (r2Client) {
  materializationService = new MaterializationService(pool, r2Client);
}
this.candlesService = new CandlesService(pool, materializationService);

// AFTER (fixed):
// Auto-materialization disabled - was causing 60s+ API timeouts
this.candlesService = new CandlesService(pool);
```

Location: `src/index.ts:58-61`

Impact: API response time improved from 60+ seconds to <1 second.

**IMPORTANT - Data must be pre-materialized:** Since auto-materialization is disabled, you must manually materialize data before it's available via the API:
```bash
# Materialize candles for a symbol/date range
npx tsx src/scripts/materialize-candles.ts EURUSD 2024-01-01 2024-12-31

# Refresh materialized views for higher timeframes
npm run refresh-mvs
```

Key lessons:
1. **Never block API responses on external I/O** - R2 downloads should be background jobs, not inline operations
2. **Understand your data domain** - Forex markets have weekends; the coverage check should have excluded them
3. **Test with production-like date ranges** - A 1-day test wouldn't have caught this; a 10-month range did
4. **Monitor API response times** - Add alerts for p95 latency >5 seconds

Future improvement (TODO): If re-enabling auto-materialization, implement:
- Weekend awareness in coverage check
- Background/async materialization (don't block response)
- Per-month caching (don't re-download same monthly file)
- Timeout with partial data response

### Database Issues

**Index creation fails:**
- Check disk space (indexes need temp space)
- Ensure no other long-running queries
- Use `CONCURRENTLY` to avoid blocking

## Security Considerations

1. **Database credentials** - Use environment variables, never commit
2. **Broker API keys** - Store securely, use client-specific authentication
3. **Production deployment** - Use SSL/TLS for all connections
4. **Rate limiting** - Implement per-client limits for API endpoints
5. **Input validation** - All user inputs are validated with Zod schemas

## Deployment (Fly.io)

```bash
# Deploy application
fly deploy

# SSH into production
fly ssh console

# Import data on production
npm run import -- --symbol EURUSD --from 2024-01-01 --to 2024-12-31 --manage-indexes
npm run refresh-mvs
```

**Production URLs:**
- WebSocket: `wss://[your-app-name].fly.dev`
- REST API: `https://[your-app-name].fly.dev/api/candles`

## Client Implementation Examples

See [API_USAGE.md](API_USAGE.md) for complete TypeScript/JavaScript and Python client examples.

## Contributing

When adding features:
1. Update relevant documentation (API_USAGE.md, IMPORT_GUIDE.md, etc.)
2. Add TypeScript types for all new interfaces
3. Update materialized views if schema changes
4. Run `npm run typecheck` and `npm run lint`
5. Update CLAUDE.md with significant changes

## References

- **TimescaleDB Documentation**: https://docs.timescale.com/
- **Dukascopy Data**: https://www.dukascopy.com/swiss/english/marketwatch/historical/
- **Binance WebSocket API**: https://binance-docs.github.io/apidocs/spot/en/
- **OANDA Stream API**: https://developer.oanda.com/rest-live-v20/streaming-ep/
