# Problem: Slow Bulk Import Performance Due to Index Overhead

## Status
🔴 **Active** - Currently impacting March 2024 data import

## Summary
Bulk data imports to `market_ticks` table are extremely slow (~10 seconds per 1000-5000 row batch) due to maintaining 4 indexes during INSERT operations. This makes importing months of historical tick data impractical.

## Current State

### Table: `market_ticks`
- **Rows**: 11.6M ticks (Feb 1, 2024 → Jan 24, 2025)
- **Active Indexes**: 4
- **Import Method**: Batch INSERT with ON CONFLICT DO NOTHING

### Active Indexes
```sql
1. forex_ticks_time_brin       -- BRIN index on time (low overhead, ~2% impact)
2. forex_ticks_symbol_time_uq  -- UNIQUE on (symbol, time) (needed for deduplication)
3. forex_ticks_time_idx        -- BTREE on time DESC (expensive, ~35% overhead)
4. forex_ticks_symbol_time_idx -- BTREE on (symbol, time) DESC (expensive, ~45% overhead)
```

### Performance Impact

**Current Performance:**
- ~10-15 seconds per 1000-5000 row batch
- Each INSERT updates all 4 indexes
- BTREE indexes #3 and #4 cause ~80% of the overhead
- March 2024 import: ~40 chunks processed in 10+ minutes

**Estimated with Optimized Indexes:**
- Drop indexes #3 and #4 → **5-10x faster inserts**
- Use COPY instead of INSERT → **10-20x faster** (but no duplicate handling)

## Root Cause

1. **Multiple BTREE Indexes**: Indexes #3 and #4 are expensive to maintain during bulk inserts
2. **INSERT vs COPY**: Using parameterized INSERT for duplicate handling instead of faster COPY
3. **Index Maintenance**: PostgreSQL updates all indexes on every INSERT, creating write amplification

## Impact

### Current Import Times (Estimated)
- **1 hour of tick data**: ~15 seconds
- **1 day of tick data**: ~6 minutes
- **1 month of tick data**: ~3 hours
- **1 year of tick data**: ~36 hours

### With Optimization (Estimated)
- **1 hour**: ~2 seconds
- **1 day**: ~50 seconds
- **1 month**: ~25 minutes
- **1 year**: ~5 hours

## Proposed Solutions

### Option 1: Smart Index Management (Recommended)
**Drop non-essential indexes before bulk import, recreate after:**

```bash
# Before import
npm run drop-import-indexes

# Run import
npm run import -- --symbol EURUSD --from 2024-03-01 --to 2024-03-31

# After import
npm run recreate-indexes
```

**Pros:**
- 5-10x faster imports
- Still handles duplicates with UNIQUE constraint
- Indexes recreated automatically

**Cons:**
- Queries slower during import (table scans instead of index scans)
- Need to remember to recreate indexes

### Option 2: Fast Import Mode with COPY
**Use PostgreSQL COPY for fresh data ranges (no duplicates):**

```typescript
// Use COPY when no duplicates expected
importer.fastImport(symbol, fromDate, toDate); // Uses COPY, 10x faster

// Use regular import when duplicates possible
importer.importTicks(symbol, fromDate, toDate); // Uses INSERT, handles duplicates
```

**Pros:**
- 10-20x faster than INSERT
- Ideal for backfilling clean date ranges

**Cons:**
- No duplicate detection
- Must ensure date range has no existing data

### Option 3: Hybrid Approach (Best of Both)
**Combine both strategies:**

1. Check if date range has existing data
2. If empty → use COPY (fast)
3. If has data → drop indexes, use INSERT, recreate indexes

## Implementation Plan

### Phase 1: Index Management Scripts
Create scripts to manage indexes during imports:
- `src/scripts/drop-import-indexes.ts` - Drop #3 and #4
- `src/scripts/recreate-indexes.ts` - Recreate all indexes
- Add to `package.json` scripts

### Phase 2: Fast Import Mode
Add COPY-based import method:
- New method `fastImportTicks()` using COPY
- Auto-detect if range is clean (no existing data)
- CLI flag: `--fast` for COPY mode

### Phase 3: Automated Hybrid
Make import script intelligent:
- Check if date range overlaps existing data
- Automatically choose COPY vs INSERT
- Manage indexes internally

## Trade-offs

| Approach | Speed | Safety | Complexity |
|----------|-------|--------|------------|
| Current (4 indexes + INSERT) | 1x | ✅ High | Low |
| Drop indexes + INSERT | 5-10x | ✅ High | Medium |
| Keep indexes + COPY | 10-20x | ⚠️ No dedup | Medium |
| Smart hybrid | 10-20x | ✅ High | High |

## Requirements Analysis

### Must Have
- ✅ Duplicate detection (ON CONFLICT)
- ✅ UNIQUE constraint on (symbol, time)
- ✅ Query performance after import

### Nice to Have
- Fast bulk imports for backfilling
- Automatic index management
- Import progress tracking

### Don't Need During Import
- BTREE index on `time` alone
- BTREE index on `(symbol, time)` - UNIQUE constraint provides this

## Questions to Resolve

1. Can we safely drop `forex_ticks_time_idx` permanently?
   - The UNIQUE constraint already provides a BTREE on (symbol, time)
   - Queries filtering by time alone could use the BRIN index

2. Can we safely drop `forex_ticks_symbol_time_idx` permanently?
   - Redundant with UNIQUE constraint forex_ticks_symbol_time_uq

3. Should we make index management automatic in the import script?
   - Pro: User doesn't need to remember
   - Con: More complex, harder to debug

## Related Issues
- Import taking hours for historical data
- Need to import entire year of forex data
- Production database growing, imports getting slower

## References
- Current import code: `src/scripts/importHistoricalData.ts`
- Database schema: Look at CREATE TABLE statements
- PostgreSQL COPY docs: https://www.postgresql.org/docs/current/sql-copy.html

## Next Steps
1. ✅ Document problem (this file)
2. ⏳ Create drop/recreate index scripts
3. ⏳ Test import speed with reduced indexes
4. ⏳ Implement COPY-based fast import
5. ⏳ Add hybrid mode to import script
