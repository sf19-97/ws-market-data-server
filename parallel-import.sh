#!/bin/bash

# Parallel R2 Import Script with DNS optimization
# This script launches parallel imports with proper UV_THREADPOOL_SIZE to avoid DNS exhaustion

# CRITICAL: Set UV_THREADPOOL_SIZE to handle parallel DNS lookups
export UV_THREADPOOL_SIZE=128

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}===================================================================${NC}"
echo -e "${GREEN}           Parallel R2 Import with DNS Optimization               ${NC}"
echo -e "${GREEN}===================================================================${NC}"
echo ""
echo -e "${YELLOW}UV_THREADPOOL_SIZE set to: ${UV_THREADPOOL_SIZE}${NC}"
echo ""

# Function to run import with proper environment
run_import() {
    local SYMBOL=$1
    local START_DATE=$2
    local END_DATE=$3

    echo -e "${GREEN}[$(date '+%H:%M:%S')] Starting import: ${SYMBOL} from ${START_DATE} to ${END_DATE}${NC}"

    # Run with increased thread pool size
    UV_THREADPOOL_SIZE=128 npx tsx src/scripts/import-to-r2.ts "$SYMBOL" "$START_DATE" "$END_DATE" &
}

# Parse command line arguments
if [ "$#" -lt 1 ]; then
    echo -e "${RED}Usage: $0 <command> [options]${NC}"
    echo ""
    echo "Commands:"
    echo "  major-pairs <start-date> <end-date>  - Import all major forex pairs"
    echo "  fill-gaps                             - Fill known gaps in data"
    echo "  single <symbol> <start> <end>         - Import single symbol"
    echo ""
    echo "Examples:"
    echo "  $0 major-pairs 2024-01-01 2024-12-31"
    echo "  $0 fill-gaps"
    echo "  $0 single EURUSD 2024-11-01 2024-11-30"
    exit 1
fi

COMMAND=$1

case $COMMAND in
    "major-pairs")
        if [ "$#" -ne 3 ]; then
            echo -e "${RED}Usage: $0 major-pairs <start-date> <end-date>${NC}"
            exit 1
        fi

        START_DATE=$2
        END_DATE=$3

        echo -e "${GREEN}Launching parallel imports for major forex pairs${NC}"
        echo -e "Period: ${START_DATE} to ${END_DATE}"
        echo ""

        # Launch all major pairs in parallel
        run_import "EURUSD" "$START_DATE" "$END_DATE"
        run_import "GBPUSD" "$START_DATE" "$END_DATE"
        run_import "USDJPY" "$START_DATE" "$END_DATE"
        run_import "USDCHF" "$START_DATE" "$END_DATE"
        run_import "AUDUSD" "$START_DATE" "$END_DATE"
        run_import "USDCAD" "$START_DATE" "$END_DATE"
        run_import "NZDUSD" "$START_DATE" "$END_DATE"

        echo ""
        echo -e "${GREEN}All imports launched!${NC}"
        echo "Monitor progress with: ps aux | grep import-to-r2"
        ;;

    "fill-gaps")
        echo -e "${GREEN}Filling known data gaps based on R2 analysis${NC}"
        echo ""

        # Fill specific gaps identified from analyze-r2.ts output
        # These are the periods that have missing or incomplete data

        # GBPUSD gaps
        run_import "GBPUSD" "2024-01-01" "2024-06-30"
        run_import "GBPUSD" "2024-07-01" "2024-10-14"

        # USDJPY gaps
        run_import "USDJPY" "2024-01-01" "2024-06-30"
        run_import "USDJPY" "2024-07-01" "2024-10-14"

        # USDCHF gaps
        run_import "USDCHF" "2024-01-01" "2024-06-30"
        run_import "USDCHF" "2024-07-01" "2024-10-14"

        # AUDUSD gaps
        run_import "AUDUSD" "2024-01-01" "2024-06-30"
        run_import "AUDUSD" "2024-07-01" "2024-10-14"

        # USDCAD gaps
        run_import "USDCAD" "2024-01-01" "2024-06-30"
        run_import "USDCAD" "2024-07-01" "2024-10-14"

        # NZDUSD gaps
        run_import "NZDUSD" "2024-01-01" "2024-06-30"
        run_import "NZDUSD" "2024-07-01" "2024-10-14"

        echo ""
        echo -e "${GREEN}Gap filling imports launched!${NC}"
        ;;

    "single")
        if [ "$#" -ne 4 ]; then
            echo -e "${RED}Usage: $0 single <symbol> <start-date> <end-date>${NC}"
            exit 1
        fi

        SYMBOL=$2
        START_DATE=$3
        END_DATE=$4

        run_import "$SYMBOL" "$START_DATE" "$END_DATE"

        echo ""
        echo -e "${GREEN}Import launched for ${SYMBOL}${NC}"
        ;;

    *)
        echo -e "${RED}Unknown command: $COMMAND${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${YELLOW}===================================================================${NC}"
echo -e "${YELLOW}IMPORTANT: The script has fixed DNS issues by:${NC}"
echo -e "${YELLOW}1. Setting UV_THREADPOOL_SIZE=128 (was 4 by default)${NC}"
echo -e "${YELLOW}2. Adding proper retry logic for network errors${NC}"
echo -e "${YELLOW}3. Increasing delay between chunks to 10 seconds${NC}"
echo -e "${YELLOW}===================================================================${NC}"
echo ""
echo "Commands to monitor progress:"
echo "  ps aux | grep import-to-r2        # See running processes"
echo "  npx tsx src/scripts/analyze-r2.ts # Check what's in R2"
echo ""