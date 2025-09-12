# WebSocket Market Data Server

A high-performance, multi-broker WebSocket server that aggregates real-time financial market data from multiple sources and provides a unified streaming interface for client applications.

## Overview

This server acts as a middleware layer between your application and various market data providers (brokers). Instead of managing multiple WebSocket connections and APIs in your client application, you connect to this single server which handles:

- **Multi-broker connections** - Connect to multiple data providers simultaneously
- **Unified interface** - Single WebSocket API regardless of broker
- **Authentication management** - Per-client broker authentication
- **Data normalization** - Consistent data format across all brokers
- **Connection resilience** - Automatic reconnection and error handling

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Client App 1   │     │  Client App 2   │     │  Client App N   │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │ WebSocket             │                        │
         └───────────────────────┼────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   WS Market Data Server │
                    │                         │
                    │  ┌─────────────────┐   │
                    │  │  BrokerManager  │   │
                    │  └────────┬────────┘   │
                    │           │             │
                    │  ┌────────┼────────┐   │
                    │  │        │        │   │
                    └──┼────────┼────────┼───┘
                       │        │        │
              ┌────────▼──┐ ┌───▼───┐ ┌──▼────────┐
              │  Binance  │ │ Oanda │ │ Broker N  │
              └───────────┘ └───────┘ └───────────┘
```

## Features

### 🔌 Multi-Broker Support
- **Binance** - Cryptocurrency trading pairs (BTC, ETH, etc.)
- **Oanda** - Forex trading pairs (EUR/USD, GBP/USD, etc.)
- Extensible architecture for adding new brokers

### 🔐 Client Authentication
- Per-client broker authentication
- Isolated broker instances per client
- Secure credential handling
- No credential persistence

### 📊 Data Types
- **Tick data** - Real-time price updates
- **Candles/OHLC** - Time-based price aggregations
- **Order book** - Market depth data
- **Trade executions** - Completed trades

### 🚀 Performance Features
- Event-driven architecture
- Efficient subscription management
- Smart broker routing based on symbol type
- Concurrent client handling

## Directory Structure

```
ws-market-data-server/
├── src/
│   ├── index.ts              # Main server entry point
│   ├── brokers/              # Broker implementations
│   │   ├── BaseBroker.ts     # Abstract base class for all brokers
│   │   ├── BinanceBroker.ts  # Binance WebSocket implementation
│   │   ├── OandaBroker.ts    # Oanda HTTP stream implementation
│   │   ├── MockBinanceBroker.ts  # Mock broker for testing
│   │   └── MockOandaBroker.ts    # Mock broker for testing
│   ├── core/                 # Core server components
│   │   ├── BrokerManager.ts  # Manages broker instances and routing
│   │   └── ClientConnection.ts # Handles individual client connections
│   ├── types/                # TypeScript type definitions
│   │   └── index.ts          # Shared interfaces and types
│   └── utils/                # Utility functions
│       └── config.ts         # Configuration loader
├── config/
│   └── config.yaml           # Server and broker configuration
├── tests/                    # Test files
├── scripts/                  # Utility scripts
├── node_modules/            # Dependencies
├── package.json             # Project dependencies and scripts
├── tsconfig.json            # TypeScript configuration
├── Dockerfile               # Container configuration
└── .env                     # Environment variables
```

### Directory Details

#### `/src/brokers/`
Contains all broker implementations. Each broker extends `BaseBroker` and implements:
- `connect()` - Establish connection to the broker
- `disconnect()` - Clean up connections
- `subscribe()` - Subscribe to market data symbols
- `unsubscribe()` - Unsubscribe from symbols

#### `/src/core/`
Core server logic:
- **BrokerManager** - Central orchestrator that manages all broker instances, handles routing, and maintains client-specific brokers
- **ClientConnection** - Manages WebSocket connections from clients, handles message parsing, and maintains per-client state

#### `/src/types/`
TypeScript interfaces for:
- `MarketData` - Standardized market data format
- `ClientMessage` - Messages from clients (subscribe, authenticate, etc.)
- `ServerMessage` - Messages to clients (data, status, error)
- `BrokerConfig` - Broker configuration structure

## Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn
- (Optional) Docker for containerized deployment

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd ws-market-data-server

# Install dependencies
npm install

# Create environment file
cp .env.example .env
```

### Configuration

Edit `config/config.yaml`:

```yaml
server:
  port: 8080
  host: '0.0.0.0'

brokers:
  - name: binance
    type: websocket
    url: 'wss://stream.binance.com:9443'
    auth: none
    enabled: true
    
  - name: oanda
    type: http-stream  
    url: 'https://stream-fxtrade.oanda.com'
    auth: bearer
    enabled: false  # Enable when you have credentials
```

### Running the Server

```bash
# Development mode with hot reload
npm run dev

# Production build
npm run build
npm start

# Run with Docker
docker build -t ws-market-data-server .
docker run -p 8080:8080 ws-market-data-server
```

## Client Usage

### 1. Connect to the Server

```javascript
const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
  console.log('Connected to market data server');
});
```

### 2. Authenticate with a Broker (Optional)

```javascript
// Method 1: Use environment variables (.env file)
// OANDA_API_KEY=your-api-key
// OANDA_ACCOUNT_ID=your-account-id

// Method 2: Runtime authentication per client
ws.send(JSON.stringify({
  action: 'authenticate',
  broker: 'oanda',
  credentials: {
    apiKey: 'your-api-key',
    accountId: 'your-account-id'
  }
}));
```

### 3. Subscribe to Market Data

```javascript
// Subscribe to cryptocurrency (Binance)
ws.send(JSON.stringify({
  action: 'subscribe',
  broker: 'binance',
  symbols: ['BTCUSDT', 'ETHUSDT'],
  types: ['tick']
}));

// Subscribe to forex (OANDA)
ws.send(JSON.stringify({
  action: 'subscribe',
  broker: 'oanda',
  symbols: ['EUR_USD', 'GBP_USD'],  // Note: underscore format
  types: ['tick']
}));
```

### 4. Receive Market Data

```javascript
ws.on('message', (data) => {
  const msg = JSON.parse(data);
  
  switch(msg.type) {
    case 'data':
      // Market data update
      console.log(`${msg.data.symbol}: $${msg.data.data.price}`);
      break;
      
    case 'status':
      // Status messages
      console.log('Status:', msg.message);
      break;
      
    case 'error':
      // Error messages
      console.error('Error:', msg.message);
      break;
  }
});
```

## Message Formats

### Client to Server

#### Subscribe
```json
{
  "action": "subscribe",
  "broker": "binance",
  "symbols": ["BTCUSDT", "ETHUSDT"],
  "types": ["tick", "candle"]
}
```

#### Authenticate
```json
{
  "action": "authenticate",
  "broker": "oanda",
  "credentials": {
    "apiKey": "your-api-key",
    "accountId": "your-account-id"
  }
}
```

#### Unsubscribe
```json
{
  "action": "unsubscribe",
  "broker": "binance",
  "symbols": ["BTCUSDT"]
}
```

### Server to Client

#### Market Data
```json
{
  "type": "data",
  "broker": "binance",
  "symbol": "BTCUSDT",
  "data": {
    "broker": "binance",
    "symbol": "BTCUSDT",
    "type": "tick",
    "timestamp": 1234567890,
    "data": {
      "price": 45123.45,
      "volume": 1.23
    }
  }
}
```

#### Status Message
```json
{
  "type": "status",
  "message": "Connected to Market Data Server"
}
```

#### Error Message
```json
{
  "type": "error",
  "message": "Authentication failed: Invalid API key"
}
```

## Adding New Brokers

1. Create a new broker class in `/src/brokers/`:

```typescript
import { BaseBroker } from "./BaseBroker.js";
import { MarketData, BrokerConfig } from "../types/index.js";

export class NewBroker extends BaseBroker {
  async connect(): Promise<void> {
    // Implement connection logic
  }
  
  async disconnect(): Promise<void> {
    // Clean up connections
  }
  
  async subscribe(symbols: string[]): Promise<void> {
    // Subscribe to symbols
  }
  
  async unsubscribe(symbols: string[]): Promise<void> {
    // Unsubscribe from symbols
  }
}
```

2. Register the broker in `BrokerManager.ts`:

```typescript
case "newbroker":
  broker = new NewBroker(config);
  break;
```

3. Add configuration in `config.yaml`:

```yaml
- name: newbroker
  type: websocket
  url: 'wss://newbroker.com/stream'
  auth: api-key
  enabled: true
```

## Monitoring

### Health Check
```bash
curl http://localhost:8080/health
```

Response:
```json
{
  "status": "healthy",
  "clients": 5,
  "uptime": 3600
}
```

### Metrics
```bash
curl http://localhost:8080/metrics
```

Response:
```json
{
  "connections": 5,
  "subscriptions": 23
}
```

## Development

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm run test` - Run test suite
- `npm run lint` - Run ESLint
- `npm run typecheck` - Run TypeScript type checking

### Testing

```bash
# Run all tests
npm test

# Test specific functionality
node test-auth-flow.js
node test-final-proof.js
```

## Security Considerations

1. **Credentials** - Never store credentials in code or config files
2. **TLS/SSL** - Use WSS (WebSocket Secure) in production
3. **Authentication** - Implement proper client authentication for production
4. **Rate Limiting** - Configure appropriate rate limits per client
5. **Input Validation** - All client inputs are validated

## Performance Tuning

- **Connection Pooling** - Reuse broker connections across clients where possible
- **Subscription Batching** - Batch multiple symbol subscriptions
- **Message Compression** - Enable WebSocket compression for large data volumes
- **Redis Integration** - Use Redis for multi-instance deployments

## Symbol Format

Different brokers use different symbol formats:
- **Binance**: `BTCUSDT`, `ETHUSDT` (no separator)
- **OANDA**: `EUR_USD`, `GBP_USD` (underscore separator)
- **Display format**: `EUR/USD`, `BTC/USDT` (slash separator)

The server automatically handles format conversion between brokers and clients.

## Troubleshooting

### Common Issues

1. **451 Error from Binance**
   - Caused by geographical restrictions
   - Use VPN or deploy to allowed region

2. **No data received**
   - Check broker is enabled in config
   - Verify authentication credentials
   - **Check symbol format**: OANDA uses `EUR_USD` not `EURUSD`
   - Server handles both `EUR_USD` and `EUR/USD` formats

3. **Connection drops**
   - Server implements automatic reconnection
   - Check network stability
   - Review broker rate limits

4. **OANDA 400 Error**
   - Occurs when connecting without instruments
   - OANDA requires at least one symbol subscription
   - The server now waits for subscriptions before connecting

## License

[Your License Here]

## Contributing

[Your Contributing Guidelines Here]