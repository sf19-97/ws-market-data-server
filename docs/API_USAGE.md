# Market Data Server API Usage Guide

## Base URLs
- **Local**: `http://localhost:8080`
- **Production (Fly.io)**: `https://[your-app-name].fly.dev`

## API Endpoints

### 1. `/api/metadata` - Discover Available Data

**Purpose**: Find out what symbols are available and their date ranges. Always call this BEFORE requesting candles.

#### Get all symbols
```bash
GET /api/metadata
```

**Response**:
```json
{
  "symbols": [
    {
      "symbol": "EURUSD",
      "earliest": 1706745600,
      "latest": 1737755998,
      "tick_count": 11600518
    }
  ],
  "timeframes": ["1m", "5m", "15m", "1h", "4h", "12h"]
}
```

#### Get specific symbol
```bash
GET /api/metadata?symbol=EURUSD
```

**Response**:
```json
{
  "symbol": "EURUSD",
  "earliest": 1706745600,
  "latest": 1737755998,
  "tick_count": 11600518,
  "timeframes": ["1m", "5m", "15m", "1h", "4h", "12h"]
}
```

### 2. `/api/candles` - Fetch Historical Candles

**Purpose**: Get OHLC candle data for a specific symbol and timeframe.

```bash
GET /api/candles?symbol=EURUSD&timeframe=1h&from=1710918000&to=1711004399
```

**Parameters**:
- `symbol` (required): Symbol name (e.g., "EURUSD")
- `timeframe` (optional): Timeframe interval - "1m", "5m", "15m", "1h", "4h", "12h" (default: "1h")
- `from` (required): Start timestamp in Unix seconds
- `to` (required): End timestamp in Unix seconds

**Response**:
```json
[
  {
    "time": 1710918000,
    "open": 1.08703,
    "high": 1.08721,
    "low": 1.08650,
    "close": 1.08656
  },
  {
    "time": 1710921600,
    "open": 1.08655,
    "high": 1.08655,
    "low": 1.08501,
    "close": 1.08523
  }
]
```

**Cache Headers**:
- The server uses ETags for browser caching
- Automatic 304 Not Modified responses
- Cache-Control headers set based on timeframe

## Client Implementation Example

### JavaScript/TypeScript

```javascript
class MarketDataClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl || (
      process.env.NODE_ENV === 'production'
        ? 'https://[your-app-name].fly.dev'
        : 'http://localhost:8080'
    );
  }

  /**
   * Get metadata for all symbols or a specific symbol
   */
  async getMetadata(symbol = null) {
    const url = symbol
      ? `${this.baseUrl}/api/metadata?symbol=${symbol}`
      : `${this.baseUrl}/api/metadata`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Metadata request failed: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get candle data for a symbol
   *
   * IMPORTANT: Always call getMetadata() first to ensure you're
   * requesting data within available bounds!
   */
  async getCandles(symbol, timeframe, fromTimestamp, toTimestamp) {
    const url = `${this.baseUrl}/api/candles?symbol=${symbol}&timeframe=${timeframe}&from=${fromTimestamp}&to=${toTimestamp}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Candles request failed: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get the most recent available data for a symbol
   * Uses metadata to determine actual latest date (not Date.now())
   */
  async getRecentCandles(symbol, timeframe = '1h', daysBack = 7) {
    // Step 1: Get metadata to find actual latest date
    const metadata = await this.getMetadata(symbol);

    // Step 2: Calculate date range using metadata.latest (NOT Date.now()!)
    const to = metadata.latest;
    const from = to - (daysBack * 24 * 60 * 60);

    // Step 3: Verify we're within bounds
    if (from < metadata.earliest) {
      console.warn(`Requested start date is before earliest available data`);
      from = metadata.earliest;
    }

    // Step 4: Fetch candles
    return this.getCandles(symbol, timeframe, from, to);
  }
}

// Usage Example
const client = new MarketDataClient();

// Discover what's available
const metadata = await client.getMetadata('EURUSD');
console.log('Data available:', {
  from: new Date(metadata.earliest * 1000),
  to: new Date(metadata.latest * 1000),
  ticks: metadata.tick_count
});

// Get most recent 7 days of 1h candles
const candles = await client.getRecentCandles('EURUSD', '1h', 7);
console.log(`Received ${candles.length} candles`);

// Get specific date range (March 20, 2024)
const march20Candles = await client.getCandles(
  'EURUSD',
  '1h',
  Math.floor(new Date('2024-03-20T00:00:00Z').getTime() / 1000),
  Math.floor(new Date('2024-03-20T23:59:59Z').getTime() / 1000)
);
```

### Python

```python
import requests
from datetime import datetime, timedelta

class MarketDataClient:
    def __init__(self, base_url=None):
        self.base_url = base_url or "http://localhost:8080"

    def get_metadata(self, symbol=None):
        """Get metadata for all symbols or a specific symbol"""
        url = f"{self.base_url}/api/metadata"
        if symbol:
            url += f"?symbol={symbol}"

        response = requests.get(url)
        response.raise_for_status()
        return response.json()

    def get_candles(self, symbol, timeframe, from_ts, to_ts):
        """Get candle data for a symbol"""
        url = f"{self.base_url}/api/candles"
        params = {
            "symbol": symbol,
            "timeframe": timeframe,
            "from": from_ts,
            "to": to_ts
        }

        response = requests.get(url, params=params)
        response.raise_for_status()
        return response.json()

    def get_recent_candles(self, symbol, timeframe="1h", days_back=7):
        """Get most recent available data (uses metadata.latest, not now)"""
        # Get metadata to find actual latest date
        metadata = self.get_metadata(symbol)

        # Calculate range using metadata.latest (NOT time.time()!)
        to_ts = metadata['latest']
        from_ts = to_ts - (days_back * 24 * 60 * 60)

        # Verify bounds
        if from_ts < metadata['earliest']:
            print(f"Warning: Adjusting start to earliest available data")
            from_ts = metadata['earliest']

        return self.get_candles(symbol, timeframe, from_ts, to_ts)

# Usage
client = MarketDataClient()

# Discover available data
metadata = client.get_metadata("EURUSD")
print(f"Data range: {datetime.fromtimestamp(metadata['earliest'])} to {datetime.fromtimestamp(metadata['latest'])}")
print(f"Total ticks: {metadata['tick_count']:,}")

# Get recent data
candles = client.get_recent_candles("EURUSD", "1h", 7)
print(f"Received {len(candles)} candles")
```

## Important Notes

1. **Always check metadata first**: Don't assume data goes up to `Date.now()`
2. **Timestamps are Unix seconds**: Not milliseconds! Divide `Date.now()` by 1000
3. **After importing new data**: Run `npm run refresh-mvs` to update materialized views
4. **Caching**: The server uses ETags and Cache-Control headers for efficient caching
5. **Timeframes**: Not all timeframes use materialized views:
   - Fast (materialized): 5m, 15m, 1h, 4h, 12h
   - Slower (computed): 1m

## Production Deployment (Fly.io)

After deploying to Fly.io:

```bash
# Deploy your code
fly deploy

# Import data on production (SSH into the Fly.io machine)
fly ssh console
npm run import -- --symbol EURUSD --from 2024-03-01 --to 2024-03-31

# Refresh materialized views
npm run refresh-mvs
```

Your production API will be available at:
```
https://[your-app-name].fly.dev/api/metadata
https://[your-app-name].fly.dev/api/candles
```
