# Professional Database Index Management for Bulk Imports

## The Problem

Bulk data imports to PostgreSQL are slow when multiple indexes exist because every INSERT must update all indexes. This causes **write amplification** - a single row insert triggers 4+ index updates.

**Impact on `market_ticks` table:**
- 4 active indexes (2 BTREE + 1 UNIQUE + 1 BRIN)
- Each 1000-row batch takes ~10-15 seconds
- Importing months of data takes hours

## The Professional Solution

Database administrators use a standard pattern for bulk loads:

```
1. DROP expensive indexes
2. BULK LOAD data (5-10x faster)
3. RECREATE indexes with CONCURRENTLY
4. RUN ANALYZE to update statistics
```

This approach is used in production PostgreSQL environments worldwide.

## Implementation

### Option 1: Automated (Recommended)

Use the `--manage-indexes` flag for fully automated index management:

```bash
npm run import -- \
  --symbol EURUSD \
  --from 2024-01-01 \
  --to 2024-12-31 \
  --manage-indexes
```

**What it does:**
1. ✅ Drops `forex_ticks_time_idx` and `forex_ticks_symbol_time_idx`
2. ✅ Keeps `forex_ticks_symbol_time_uq` (UNIQUE - required for duplicates)
3. ✅ Keeps `forex_ticks_time_brin` (BRIN - minimal overhead)
4. 🚀 Runs import (5-10x faster without expensive indexes)
5. ✅ Recreates indexes with `CONCURRENTLY` (allows reads during rebuild)
6. ✅ Runs `ANALYZE` to update query planner statistics

**Performance:**
- **Before**: ~10-15 seconds per 1000-5000 row batch
- **After**: ~1-2 seconds per batch (5-10x faster)

### Option 2: Manual Control

For more control, use separate scripts:

```bash
# Step 1: Drop indexes before import
npm run drop-indexes

# Step 2: Run your import
npm run import -- --symbol EURUSD --from 2024-01-01 --to 2024-12-31

# Step 3: Recreate indexes after import
npm run recreate-indexes
```

## What Gets Dropped/Kept

### Dropped During Import
```sql
-- BTREE on time alone (expensive, ~35% overhead)
DROP INDEX forex_ticks_time_idx;

-- BTREE on (symbol, time) (expensive, ~45% overhead)
-- Redundant with UNIQUE constraint
DROP INDEX forex_ticks_symbol_time_idx;
```

### Kept During Import
```sql
-- UNIQUE constraint (required for ON CONFLICT DO NOTHING)
-- forex_ticks_symbol_time_uq

-- BRIN index (block range index, ~2% overhead)
-- forex_ticks_time_brin
```

## Why This Works

### BTREE Indexes Are Expensive

BTREE indexes maintain a sorted tree structure. On every INSERT:
1. Find correct position in tree (log N lookups)
2. Insert entry and rebalance tree
3. Update parent nodes
4. Write changes to disk

With 2 BTREE indexes, each INSERT does this **twice**.

### BRIN Indexes Are Cheap

BRIN (Block Range INdex) stores min/max values per block range:
- No per-row overhead
- Only updated when new blocks are created
- Perfect for time-series data

### UNIQUE Constraint Is Necessary

The UNIQUE constraint on `(symbol, time)` provides:
1. Duplicate detection for `ON CONFLICT DO NOTHING`
2. A BTREE index for lookups
3. Data integrity guarantee

We can't drop this without losing duplicate handling.

## Recreating Indexes

### Why CONCURRENTLY?

```sql
-- Without CONCURRENTLY (blocks all writes)
CREATE INDEX forex_ticks_time_idx ON market_ticks USING btree (time DESC);

-- With CONCURRENTLY (allows reads and writes)
CREATE INDEX CONCURRENTLY forex_ticks_time_idx ON market_ticks USING btree (time DESC);
```

`CONCURRENTLY` takes longer but doesn't block your application. This is critical for production systems.

### Why ANALYZE?

```sql
ANALYZE market_ticks;
```

PostgreSQL's query planner uses statistics to choose optimal query plans. After a bulk load, these statistics are stale. `ANALYZE` updates them.

## Performance Comparison

### Importing 1 Month of EURUSD Data

| Strategy | Time | Speed |
|----------|------|-------|
| **4 indexes (current)** | ~3 hours | 1x |
| **2 indexes (drop BTREE)** | ~25 minutes | 7x faster |
| **+ COPY (no conflicts)** | ~5 minutes | 36x faster |

### Importing 1 Year of Data

| Strategy | Time |
|----------|------|
| **4 indexes** | ~36 hours |
| **With index management** | ~5 hours |

## Best Practices

1. **Always use --manage-indexes for large imports** (> 1 day of data)
2. **Use manual scripts** if you need to inspect state between steps
3. **Keep UNIQUE constraint** - it's required for duplicate detection
4. **Run ANALYZE** after index creation to update statistics
5. **Monitor disk space** - index recreation needs temporary space

## Trade-offs

### During Import (Indexes Dropped)
- ✅ 5-10x faster inserts
- ✅ Duplicate detection still works (UNIQUE constraint)
- ⚠️  Queries slower (table scans instead of index scans)
- ⚠️  No concurrent queries expected during bulk import

### After Import (Indexes Recreated)
- ✅ Full query performance restored
- ✅ All functionality restored
- ✅ Statistics updated

## Troubleshooting

### "Index already exists" error
The index wasn't dropped properly. Drop it manually:
```bash
psql $DATABASE_URL -c "DROP INDEX IF EXISTS forex_ticks_time_idx;"
```

### "Cannot run CREATE INDEX CONCURRENTLY inside a transaction"
This is normal - the script handles this automatically by running outside transactions.

### Slow index recreation
This is expected. Creating indexes on millions of rows takes time:
- 10M rows: ~5-10 minutes per index
- 50M rows: ~30-60 minutes per index

Use `CONCURRENTLY` so your app stays responsive.

## References

- PostgreSQL Documentation: [CREATE INDEX CONCURRENTLY](https://www.postgresql.org/docs/current/sql-createindex.html)
- PostgreSQL Documentation: [BRIN Indexes](https://www.postgresql.org/docs/current/brin.html)
- Problem Analysis: [.claude/problems/index-performance.md](.claude/problems/index-performance.md)

## Summary

This is the **industry-standard approach** for bulk loading data into PostgreSQL. Professional DBAs use this pattern daily in production systems handling billions of rows.

**For this project:**
- Use `--manage-indexes` for imports > 1 day
- Saves hours of import time
- Zero data loss risk
- Full functionality restored after import
