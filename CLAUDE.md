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
│   ├── scripts/                    # Data import and maintenance
│   │   ├── import-cli.ts           # CLI for historical data import
│   │   ├── importHistoricalData.ts # Core importer class
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
├── API_USAGE.md                    # REST API client guide
├── IMPORT_GUIDE.md                 # Historical data import guide
├── INDEX_MANAGEMENT.md             # Database performance optimization
└── ARCHITECTURE.md                 # Detailed architecture docs
```

### Key Directories

- **`/src/brokers/`** - Broker implementations for real-time data (Binance, OANDA)
- **`/src/scripts/`** - Historical data import tools and database maintenance
- **`/src/core/`** - WebSocket server and connection management
- **`.claude/problems/`** - Technical analysis and performance investigations

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
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/market_data

# Optional: Broker credentials
OANDA_API_KEY=your-api-key
OANDA_ACCOUNT_ID=your-account-id
```

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

### Quick Start

```bash
# Import last 7 days of EURUSD
npm run import -- --symbol EURUSD --days 7

# Import specific date range
npm run import -- --symbol EURUSD --from 2024-03-01 --to 2024-03-31

# Import with automatic index management (recommended for large imports)
npm run import -- --symbol EURUSD --from 2024-01-01 --to 2024-12-31 --manage-indexes
```

### After Importing

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

## Recent Updates (Updated: 2025-01-25)

### Major Features Added

**Historical Data Import System** (Commits: 2b59e35, 900a6a9)
- Professional CLI tool for importing Dukascopy tick data
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

- `API_USAGE.md` - Complete REST API client guide with examples
- `IMPORT_GUIDE.md` - Historical data import instructions
- `INDEX_MANAGEMENT.md` - Database performance optimization guide
- `.claude/problems/index-performance.md` - Technical analysis of import performance

### Scripts Added

```bash
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

### Import Performance

**Before optimization:**
- ~10-15 seconds per 1000-row batch
- ~3 hours for 1 month of data

**After optimization:**
- ~1-2 seconds per batch (5-10x faster)
- ~25 minutes for 1 month of data

## Important Notes

### Data Import Best Practices

1. **Always check metadata first** - Don't assume data exists up to current date
2. **Use `--manage-indexes` for large imports** - 5-10x performance improvement
3. **Refresh materialized views after imports** - `npm run refresh-mvs`
4. **Import in chunks** - Default 7-day chunks for optimal memory usage

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
