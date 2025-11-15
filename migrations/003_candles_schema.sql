-- Migration: Create candles_5m table and materialized views for R2 data lake
-- Description: Creates the core 5-minute candles table and materialized views
--              for 15m, 1h, 4h, and 12h timeframes.
--
-- Usage: psql $DATABASE_URL < migrations/003_candles_schema.sql

BEGIN;

-- ============================================================================
-- 1. Create 5-minute candles table
-- ============================================================================

CREATE TABLE IF NOT EXISTS candles_5m (
    time        timestamptz      NOT NULL,
    symbol      text             NOT NULL,
    open        double precision NOT NULL,
    high        double precision NOT NULL,
    low         double precision NOT NULL,
    close       double precision NOT NULL,
    volume      double precision DEFAULT 0,
    trades      integer          DEFAULT 0,
    source      text             DEFAULT 'r2'
);

-- Convert to hypertable (partitioned by time)
SELECT create_hypertable('candles_5m', 'time', if_not_exists => TRUE);

-- ============================================================================
-- 2. Add unique constraint for upserts
-- ============================================================================
-- CRITICAL: Required for ON CONFLICT in materializer script

ALTER TABLE candles_5m
  ADD CONSTRAINT candles_5m_symbol_time_uniq
  UNIQUE (symbol, time);

-- ============================================================================
-- 3. Create indexes for fast queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS candles_5m_symbol_time_idx
  ON candles_5m (symbol, time DESC);

-- ============================================================================
-- 4. Materialized view for 15-minute candles
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS candles_15m AS
SELECT
  time_bucket('15 minutes', time) AS time,
  symbol,
  (array_agg(open ORDER BY time))[1] AS open,
  max(high) AS high,
  min(low) AS low,
  (array_agg(close ORDER BY time DESC))[1] AS close,
  sum(volume) AS volume,
  sum(trades) AS trades
FROM candles_5m
GROUP BY time_bucket('15 minutes', time), symbol;

CREATE UNIQUE INDEX IF NOT EXISTS candles_15m_symbol_time_idx
  ON candles_15m (symbol, time);

-- ============================================================================
-- 5. Materialized view for 1-hour candles
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS candles_1h AS
SELECT
  time_bucket('1 hour', time) AS time,
  symbol,
  (array_agg(open ORDER BY time))[1] AS open,
  max(high) AS high,
  min(low) AS low,
  (array_agg(close ORDER BY time DESC))[1] AS close,
  sum(volume) AS volume,
  sum(trades) AS trades
FROM candles_5m
GROUP BY time_bucket('1 hour', time), symbol;

CREATE UNIQUE INDEX IF NOT EXISTS candles_1h_symbol_time_idx
  ON candles_1h (symbol, time);

-- ============================================================================
-- 6. Materialized view for 4-hour candles
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS candles_4h AS
SELECT
  time_bucket('4 hours', time) AS time,
  symbol,
  (array_agg(open ORDER BY time))[1] AS open,
  max(high) AS high,
  min(low) AS low,
  (array_agg(close ORDER BY time DESC))[1] AS close,
  sum(volume) AS volume,
  sum(trades) AS trades
FROM candles_5m
GROUP BY time_bucket('4 hours', time), symbol;

CREATE UNIQUE INDEX IF NOT EXISTS candles_4h_symbol_time_idx
  ON candles_4h (symbol, time);

-- ============================================================================
-- 7. Materialized view for 12-hour candles
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS candles_12h AS
SELECT
  time_bucket('12 hours', time) AS time,
  symbol,
  (array_agg(open ORDER BY time))[1] AS open,
  max(high) AS high,
  min(low) AS low,
  (array_agg(close ORDER BY time DESC))[1] AS close,
  sum(volume) AS volume,
  sum(trades) AS trades
FROM candles_5m
GROUP BY time_bucket('12 hours', time), symbol;

CREATE UNIQUE INDEX IF NOT EXISTS candles_12h_symbol_time_idx
  ON candles_12h (symbol, time);

COMMIT;

-- ============================================================================
-- Migration complete!
-- ============================================================================

-- Verify tables were created:
-- \d+ candles_5m
-- \d+ candles_15m
-- \d+ candles_1h
-- \d+ candles_4h
-- \d+ candles_12h

-- To refresh materialized views after data changes:
-- REFRESH MATERIALIZED VIEW CONCURRENTLY candles_15m;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY candles_1h;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY candles_4h;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY candles_12h;
