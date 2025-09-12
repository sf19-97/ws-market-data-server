# Architecture Documentation

## System Design

The WebSocket Market Data Server follows a layered, event-driven architecture designed for high performance and extensibility.

## Core Components

### 1. Server Layer (`/src/index.ts`)

The main entry point that coordinates all components:

```typescript
MarketDataServer
├── Express HTTP Server (health/metrics endpoints)
├── WebSocket Server (client connections)
├── BrokerManager (broker orchestration)
└── ClientConnections Map (active clients)
```

**Responsibilities:**
- Initialize HTTP and WebSocket servers
- Manage client lifecycle (connect/disconnect)
- Route client events to appropriate handlers
- Broadcast market data to subscribed clients
- Graceful shutdown handling

### 2. Client Connection Layer (`/src/core/ClientConnection.ts`)

Manages individual WebSocket client sessions:

```typescript
ClientConnection
├── WebSocket instance
├── Subscription Set (tracked symbols)
├── Broker Credentials Map
└── Event Handlers
```

**Key Features:**
- Message parsing and validation
- Subscription management per client
- Client-specific authentication storage
- Heartbeat mechanism (30s intervals)
- Automatic cleanup on disconnect

### 3. Broker Manager (`/src/core/BrokerManager.ts`)

Central orchestrator for all broker connections:

```typescript
BrokerManager
├── Global Brokers Map (shared instances)
├── Client Brokers Map (authenticated instances)
└── Symbol-to-Broker routing Map
```

**Core Functions:**
- `addBroker()` - Initialize global broker instances
- `addClientBroker()` - Create authenticated client-specific brokers
- `subscribe()` - Route subscriptions to appropriate brokers
- `getBroker()` - Retrieve broker instance (client-specific or global)

### 4. Broker Layer (`/src/brokers/`)

Abstract base class and concrete implementations:

```typescript
BaseBroker (Abstract)
├── BinanceBroker (WebSocket-based)
├── OandaBroker (HTTP stream-based)
├── MockBinanceBroker (Testing)
└── MockOandaBroker (Testing)
```

**Broker Lifecycle:**
1. Constructor - Initialize with config
2. `connect()` - Establish connection to provider
3. `subscribe()` - Subscribe to market symbols
4. `handleMessage()` - Parse and emit normalized data
5. `disconnect()` - Cleanup resources

## Data Flow

### 1. Client Authentication Flow

```
Client                Server              BrokerManager         Broker
  |                     |                     |                   |
  |--authenticate------>|                     |                   |
  |                     |--addClientBroker--->|                   |
  |                     |                     |--new Broker------>|
  |                     |                     |                   |--connect-->
  |                     |                     |<--success---------|<--connected--
  |<--authenticated-----|<--broker added-----|                   |
```

### 2. Subscription Flow

```
Client                Server              BrokerManager         Broker
  |                     |                     |                   |
  |--subscribe--------->|                     |                   |
  |                     |--subscribe--------->|                   |
  |                     |                     |--getBroker------->|
  |                     |                     |--subscribe------->|
  |                     |                     |                   |--subscribe-->
  |<--status------------|<--success----------|<--subscribed------|
```

### 3. Market Data Flow

```
Broker              BrokerManager         Server              Client
  |                     |                     |                   |
  |--market data------->|                     |                   |
  |                     |--emit('data')------>|                   |
  |                     |                     |--broadcastData--->|
  |                     |                     |                   |--filter by subscription
  |                     |                     |                   |--send data-->
```

## Event System

The server uses Node.js EventEmitter for loose coupling:

### BrokerManager Events
- `data` - Emitted when market data is received
- `error` - Emitted on broker errors

### ClientConnection Events  
- `subscribe` - Client wants to subscribe to symbols
- `unsubscribe` - Client wants to unsubscribe
- `broker-auth` - Client provides broker credentials
- `disconnect` - Client connection closed

### BaseBroker Events
- `data` - Market data received and normalized
- `error` - Connection or parsing errors

## Message Protocol

### WebSocket Message Format

All messages are JSON-encoded with a consistent structure:

#### Client → Server
```typescript
interface ClientMessage {
  action: "subscribe" | "unsubscribe" | "auth" | "authenticate";
  broker?: string;
  symbols?: string[];
  types?: Array<"tick" | "candle" | "orderbook" | "trade">;
  credentials?: {
    apiKey?: string;
    apiSecret?: string;
    accountId?: string;
    token?: string;
  };
}
```

#### Server → Client
```typescript
interface ServerMessage {
  type: "data" | "status" | "error";
  broker?: string;
  symbol?: string;
  data?: MarketData;
  message?: string;
}
```

## Scalability Considerations

### Current Architecture (Single Instance)
- In-memory client and broker management
- Direct WebSocket connections
- Local subscription tracking

### Future Scaling Options

1. **Horizontal Scaling with Redis**
```
┌─────────┐     ┌─────────┐     ┌─────────┐
│Server 1 │     │Server 2 │     │Server N │
└────┬────┘     └────┬────┘     └────┬────┘
     │               │               │
     └───────────────┼───────────────┘
                     │
              ┌──────▼──────┐
              │    Redis    │
              │  Pub/Sub    │
              └─────────────┘
```

2. **Broker Connection Pooling**
- Shared broker connections across clients
- Reduced API calls and connection overhead
- Centralized rate limit management

3. **Load Balancing**
- Sticky sessions for WebSocket connections
- Client-based routing
- Geographic distribution

## Security Architecture

### Authentication Layers

1. **Client Authentication** (Optional)
   - WebSocket connection authentication
   - JWT or API key validation
   - Rate limiting per client

2. **Broker Authentication** (Required)
   - Per-client broker credentials
   - Encrypted credential storage
   - No credential persistence

### Data Isolation
- Client-specific broker instances
- Filtered data broadcasting
- No cross-client data leakage

## Error Handling

### Connection Resilience
1. Automatic broker reconnection (5s delay)
2. Client heartbeat monitoring
3. Graceful degradation on broker failure

### Error Propagation
```
Broker Error → BrokerManager → Server → Client
         ↓
    Logger/Monitoring
```

## Configuration Management

### Hierarchical Configuration
1. Default configuration in code
2. `config.yaml` file overrides
3. Environment variables (highest priority)

### Dynamic Configuration
- Broker enable/disable without restart
- Runtime authentication updates
- Per-client configuration options

## Performance Optimizations

### Message Processing
- Minimal parsing overhead
- Direct event emission
- Subscription-based filtering

### Memory Management  
- Cleanup on client disconnect
- Broker instance pooling
- Efficient subscription tracking

### Network Optimization
- WebSocket compression support
- Batched updates where possible
- Heartbeat for connection health