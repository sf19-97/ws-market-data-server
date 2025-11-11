# Historical Data Import Guide

## Overview

This project includes tools to import historical tick data from Dukascopy bi5 files into your TimescaleDB database.

## Quick Start

### Import Recent Data
```bash
# Import last 7 days
npm run import -- --symbol EURUSD --days 7

# Import last 30 days
npm run import -- --symbol EURUSD --days 30
```

### Import Specific Date Range
```bash
# Import January 2024
npm run import -- --symbol EURUSD --from 2024-01-01 --to 2024-01-31

# Import with smaller chunks (1 day at a time)
npm run import -- --symbol EURUSD --from 2024-01-01 --to 2024-01-31 --chunk 1
```

### Import Other Assets
```bash
# Bitcoin
npm run import -- --symbol BTCUSD --days 30

# Other forex pairs
npm run import -- --symbol GBPUSD --days 30
npm run import -- --symbol USDJPY --days 30
```

## After Importing

### 1. Refresh Materialized Views
```bash
npm run refresh-mvs
```

This updates the pre-aggregated candle views (5m, 15m, 1h, 4h, 12h) with the new data.

### 2. Verify Data
```bash
# Check total ticks
psql $DATABASE_URL -c "SELECT COUNT(*), MIN(time), MAX(time) FROM market_ticks;"

# Check by symbol
psql $DATABASE_URL -c "SELECT symbol, COUNT(*), MIN(time), MAX(time) FROM market_ticks GROUP BY symbol;"
```

### 3. Test API
```bash
curl "http://localhost:8080/api/candles?symbol=EURUSD&timeframe=1h&from=1706745600&to=1706832000"
```

## Performance

### Import Speed
- **~100k-150k ticks/day** for forex pairs
- **~10-15 seconds per day** of data
- **~1-2 minutes per week** (7-day chunk)

### Storage
- **1 day of EURUSD**: ~100-150k ticks ≈ 10-15 MB
- **1 month**: ~3-4.5M ticks ≈ 300-450 MB
- **1 year**: ~40-50M ticks ≈ 4-5 GB (before compression)

### Recommendations
- Use **7-day chunks** for bulk imports (good balance)
- Use **1-day chunks** for recent data or testing
- Enable TimescaleDB compression for older data

## Troubleshooting

### No Data Found
Market might be closed (weekends) or data not available yet for recent dates. Try dates from at least 1-2 days ago.

### Slow Imports
- Check network connection
- Dukascopy might have rate limits
- Consider smaller chunk sizes

### Duplicates
The importer will warn if data exists. To avoid duplicates, check existing data first:
```bash
psql $DATABASE_URL -c "SELECT MIN(time), MAX(time) FROM market_ticks WHERE symbol='EURUSD';"
```

## Architecture

### Files
- `src/scripts/importHistoricalData.ts` - Core importer class
- `src/scripts/import-cli.ts` - CLI interface
- Uses `dukascopy-node` library for bi5 file parsing
- Uses PostgreSQL COPY for fast bulk inserts

### Database Tables
- `market_ticks` - Raw tick data (renamed from `forex_ticks`)
- `forex_candles_5m/15m/1h/4h/12h` - Materialized views

### Performance Optimizations
- PostgreSQL COPY (100x faster than INSERT)
- Chunked imports to avoid memory issues
- Concurrent materialized view refreshes
- TimescaleDB hypertables for efficient time-series storage

## Examples

### Fill Missing Data Gaps
```bash
# Check existing data
psql $DATABASE_URL -c "SELECT MIN(time), MAX(time) FROM market_ticks WHERE symbol='EURUSD';"

# Fill the gap
npm run import -- --symbol EURUSD --from 2024-03-01 --to 2024-06-01 --chunk 7
```

### Build Complete Historical Database
```bash
# Import last 3 months in weekly chunks
npm run import -- --symbol EURUSD --days 90 --chunk 7

# Import specific symbols
for symbol in EURUSD GBPUSD USDJPY; do
  npm run import -- --symbol $symbol --days 90 --chunk 7
  sleep 10  # Brief pause between symbols
done
```

### Test Small Sample
```bash
# Import just 1 day for testing
npm run import -- --symbol EURUSD --from 2024-11-01 --to 2024-11-02

# Refresh views
npm run refresh-mvs

# Test API immediately
curl "http://localhost:8080/api/candles?symbol=EURUSD&timeframe=5m&from=1730419200&to=1730505600"
```
