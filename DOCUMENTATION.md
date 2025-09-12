# WebSocket Market Data Server Documentation

## 📚 Documentation Overview

This repository contains a high-performance WebSocket server for aggregating real-time financial market data from multiple brokers into a unified streaming interface.

### Documentation Files

1. **README.md** - Complete user guide including:
   - Overview and architecture diagram
   - Feature list and benefits
   - Directory structure with detailed explanations
   - Getting started guide
   - Client usage examples with code
   - Message format reference
   - Instructions for adding new brokers
   - Monitoring endpoints
   - Security considerations
   - Troubleshooting guide

2. **ARCHITECTURE.md** - Technical deep-dive covering:
   - System design and component relationships
   - Detailed component descriptions
   - Data flow diagrams for auth, subscription, and market data
   - Event system documentation  
   - Message protocol specifications
   - Scalability options for production
   - Security architecture
   - Error handling strategies
   - Performance optimizations

## 📁 Directory Index

```
ws-market-data-server/
├── src/
│   ├── index.ts              # Main server - coordinates everything
│   ├── brokers/              # Market data provider implementations
│   │   ├── BaseBroker.ts     # Abstract interface all brokers implement
│   │   ├── BinanceBroker.ts  # Real Binance WebSocket integration
│   │   ├── OandaBroker.ts    # Real Oanda streaming API integration
│   │   ├── MockBinanceBroker.ts  # Simulated crypto data for testing
│   │   └── MockOandaBroker.ts    # Simulated forex data for testing
│   ├── core/                 # Core server logic
│   │   ├── BrokerManager.ts  # Orchestrates all brokers, handles routing
│   │   └── ClientConnection.ts # Manages each WebSocket client session
│   ├── types/                # TypeScript definitions
│   │   └── index.ts          # All interfaces and types
│   └── utils/                # Helper functions
│       └── config.ts         # Loads config from YAML/env
├── config/
│   └── config.yaml           # Main configuration file
├── tests/                    # Test files and examples
├── scripts/                  # Build and deployment scripts
└── [build/config files]      # Package.json, tsconfig, etc.
```

### Key Components Explained

#### `/src/index.ts` - Main Server Entry Point
- Initializes Express HTTP server for health/metrics endpoints
- Sets up WebSocket server for client connections
- Coordinates BrokerManager and ClientConnections
- Handles graceful shutdown on process signals

#### `/src/brokers/` - Broker Implementations
Each broker extends `BaseBroker` and implements:
- **connect()** - Establish connection to market data provider
- **disconnect()** - Clean up connections and resources
- **subscribe()** - Subscribe to specific market symbols
- **unsubscribe()** - Remove symbol subscriptions
- **handleMessage()** - Parse provider data and emit normalized format

#### `/src/core/BrokerManager.ts` - Broker Orchestration
- Manages both global brokers (shared) and client-specific brokers (authenticated)
- Routes symbol subscriptions to appropriate brokers
- Handles broker lifecycle and error recovery
- Implements smart routing (e.g., forex → Oanda, crypto → Binance)

#### `/src/core/ClientConnection.ts` - Client Session Management
- Wraps each WebSocket connection
- Maintains per-client subscription state
- Stores client-specific broker credentials
- Filters market data to only subscribed symbols
- Implements heartbeat for connection health

#### `/src/types/index.ts` - TypeScript Interfaces
- **MarketData** - Normalized format for all market data
- **ClientMessage** - Messages from clients (subscribe, auth, etc.)
- **ServerMessage** - Messages to clients (data, status, error)
- **BrokerConfig** - Configuration structure for brokers

## Quick Start

1. **Install and Configure**
   ```bash
   npm install
   cp config/config.yaml.example config/config.yaml
   # Edit config.yaml with your broker settings
   ```

2. **Run the Server**
   ```bash
   npm run dev  # Development with hot reload
   npm start    # Production
   ```

3. **Connect Your Application**
   ```javascript
   const ws = new WebSocket('ws://localhost:8080');
   
   // Authenticate with broker (if required)
   ws.send(JSON.stringify({
     action: 'authenticate',
     broker: 'oanda',
     credentials: {
       apiKey: 'your-key',
       accountId: 'your-account'
     }
   }));
   
   // Subscribe to market data
   ws.send(JSON.stringify({
     action: 'subscribe',
     symbols: ['EUR/USD', 'BTC/USDT'],
     types: ['tick']
   }));
   ```

## Key Features

- **Multi-Broker Support** - Connect to multiple providers simultaneously
- **Unified Interface** - Single WebSocket API regardless of broker
- **Per-Client Authentication** - Isolated broker sessions per client
- **Automatic Routing** - Smart symbol-to-broker routing
- **Real-time Streaming** - Low-latency market data delivery
- **Error Recovery** - Automatic reconnection and resilience
- **Extensible** - Easy to add new brokers or data types

The documentation provides everything needed to understand, use, and extend the server for any market data aggregation needs.