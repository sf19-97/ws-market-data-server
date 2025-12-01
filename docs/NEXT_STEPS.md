# Next Steps - Prioritized Improvements

**Date**: 2025-01-25
**Status**: Ready for implementation

This document outlines the prioritized improvements identified in the comprehensive code review. Items are organized by priority and effort required.

---

## 🔴 Critical Priority (Do First)

### 1. Add Comprehensive Test Suite
**Priority**: CRITICAL
**Effort**: High (15-25 hours)
**Impact**: Enables safe refactoring, catches regressions, production confidence

#### Action Items:
- [ ] Create Jest configuration (`jest.config.ts`)
- [ ] Set up test utilities and mocks
- [ ] Add unit tests for services (target 80%+ coverage):
  - [ ] `src/services/__tests__/metadataService.test.ts`
  - [ ] `src/services/__tests__/candlesService.test.ts`
  - [ ] `src/services/__tests__/indexService.test.ts`
- [ ] Add middleware tests:
  - [ ] `src/middleware/__tests__/validation.test.ts`
  - [ ] `src/middleware/__tests__/errorHandler.test.ts`
- [ ] Add integration tests:
  - [ ] API endpoint tests with supertest
  - [ ] Database integration tests
  - [ ] WebSocket connection tests
- [ ] Set up test coverage reporting
- [ ] Add test scripts to `package.json`:
  ```json
  "test:unit": "jest --testPathPattern=__tests__",
  "test:integration": "jest --testPathPattern=integration",
  "test:coverage": "jest --coverage",
  "test:watch": "jest --watch"
  ```

#### Example Test Structure:
```typescript
// src/services/__tests__/metadataService.test.ts
import { Pool } from 'pg';
import { MetadataService } from '../metadataService';

describe('MetadataService', () => {
  let service: MetadataService;
  let mockPool: jest.Mocked<Pool>;

  beforeEach(() => {
    mockPool = {
      query: jest.fn(),
    } as any;
    service = new MetadataService(mockPool);
  });

  describe('getSymbolMetadata', () => {
    it('should return metadata for existing symbol', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          symbol: 'EURUSD',
          earliest: new Date('2024-01-01'),
          latest: new Date('2024-12-31'),
          tick_count: '1000000'
        }]
      });

      const result = await service.getSymbolMetadata('EURUSD');

      expect(result).toMatchObject({
        symbol: 'EURUSD',
        earliest: expect.any(Number),
        latest: expect.any(Number),
        tick_count: 1000000
      });
    });

    it('should return null for non-existent symbol', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await service.getSymbolMetadata('INVALID');

      expect(result).toBeNull();
    });
  });
});
```

---

## 🟠 High Priority (Do Soon)

### 2. Replace console.log with Pino Logger
**Priority**: HIGH
**Effort**: Medium (3-4 hours)
**Impact**: Better production debugging, structured logs, log levels

#### Files to Update:
- `src/core/BrokerManager.ts` (10+ instances)
- `src/brokers/OandaBroker.ts` (8+ instances)
- `src/brokers/BinanceBroker.ts` (5+ instances)
- `src/brokers/KrakenBroker.ts` (if exists)

#### Action Items:
- [ ] Pass logger instance to BrokerManager constructor
- [ ] Pass logger to all broker constructors
- [ ] Replace all console.log with `logger.info()`
- [ ] Replace all console.warn with `logger.warn()`
- [ ] Replace all console.error with `logger.error()`
- [ ] Add structured context to logs:
  ```typescript
  // Before
  console.log(`Client ${clientId} subscribing to:`, data);

  // After
  logger.info({
    clientId,
    broker: data.broker,
    symbols: data.symbols
  }, 'Client subscribing');
  ```

#### Example Changes:
```typescript
// src/core/BrokerManager.ts
export class BrokerManager extends EventEmitter {
  constructor(private logger: Logger) {
    super();
  }

  async addBroker(config: BrokerConfig): Promise<void> {
    // Before: console.warn(`Unknown broker type: ${config.name}`);
    // After:
    this.logger.warn({ brokerType: config.name }, 'Unknown broker type');
  }
}
```

---

### 3. Fix OandaBroker Multi-Symbol Support
**Priority**: HIGH
**Effort**: Medium (2-3 hours)
**Impact**: Enables multiple forex symbol subscriptions

#### Current Issue:
```typescript
// src/brokers/OandaBroker.ts:156-162
const instrument = Array.from(this.subscriptions)[0]; // Only handles first symbol
```

The broker assumes only one symbol is subscribed and uses the first subscription for all PRICE messages.

#### Investigation Needed:
- [ ] Check OANDA API documentation for instrument identification in PRICE messages
- [ ] Test with multiple subscriptions to see if instrument is included in response
- [ ] Options:
  1. If OANDA includes instrument in PRICE: Parse it from message
  2. If not: Maintain separate connection per instrument
  3. Alternative: Track price ranges per instrument and match incoming prices

#### Possible Solution:
```typescript
private handleMessage(msg: any): void {
  if (msg.type === "PRICE") {
    // Option 1: If OANDA includes instrument in message
    const instrument = msg.instrument || this.inferInstrument(msg);

    // Option 2: Maintain connection per instrument
    // Refactor to create separate streams per symbol
  }
}

private inferInstrument(msg: any): string {
  // Match price to instrument based on recent prices
  // This is a fallback if instrument not in message
}
```

---

### 4. Sanitize Sensitive Data from Logs
**Priority**: MEDIUM-HIGH
**Effort**: Low (1-2 hours)
**Impact**: Prevents credential/PII leakage in logs

#### File to Update:
- `src/middleware/errorHandler.ts:59-65`

#### Action Items:
- [ ] Create log sanitizer function
- [ ] Remove sensitive fields from logged objects
- [ ] Apply to error handler middleware

#### Implementation:
```typescript
// src/utils/logSanitizer.ts
export function sanitizeForLogging(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;

  const sensitiveFields = ['password', 'apiKey', 'token', 'secret', 'credentials'];
  const sanitized = { ...obj };

  for (const key in sanitized) {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object') {
      sanitized[key] = sanitizeForLogging(sanitized[key]);
    }
  }

  return sanitized;
}

// src/middleware/errorHandler.ts
logger.error({
  err,
  path: req.path,
  method: req.method,
  query: sanitizeForLogging(req.query),
  body: sanitizeForLogging(req.body)
}, 'Unhandled error');
```

---

## 🟡 Medium Priority (Nice to Have)

### 5. Move Hardcoded Broker Configs to Constants
**Priority**: MEDIUM
**Effort**: Low (1 hour)
**Impact**: Better maintainability, easier testing

#### File to Update:
- `src/core/BrokerManager.ts:58-64`

#### Action Items:
- [ ] Create `BROKER_DEFAULTS` in `src/utils/constants.ts`
- [ ] Move all hardcoded URLs and configs
- [ ] Update BrokerManager to use constants

#### Implementation:
```typescript
// src/utils/constants.ts
export const BROKER_DEFAULTS = {
  oanda: {
    type: 'http-stream' as const,
    url: 'https://stream-fxtrade.oanda.com',
    auth: 'bearer' as const
  },
  binance: {
    type: 'websocket' as const,
    url: 'wss://stream.binance.com:9443',
    auth: 'none' as const
  }
} as const;

// src/core/BrokerManager.ts
const defaults = BROKER_DEFAULTS[brokerName.toLowerCase()];
if (!defaults) {
  throw new Error(`Unknown broker: ${brokerName}`);
}

const config: BrokerConfig = {
  name: brokerName,
  ...defaults,
  enabled: true,
  credentials
};
```

---

### 6. Add Type Annotations for Return Types
**Priority**: MEDIUM
**Effort**: Low (1 hour)
**Impact**: Better type safety, improved IDE support

#### Files to Update:
- `src/utils/config.ts:5` - Change `Promise<any>` to `Promise<ServerConfig>`
- Any other functions returning `any`

#### Action Items:
- [ ] Search for `Promise<any>` in codebase
- [ ] Search for functions without return type annotations
- [ ] Add explicit return types

---

### 7. Add ESLint Configuration
**Priority**: MEDIUM
**Effort**: Low (1 hour)
**Impact**: Consistent code style, catch common errors

#### Action Items:
- [ ] Create `.eslintrc.json`:
  ```json
  {
    "parser": "@typescript-eslint/parser",
    "extends": [
      "eslint:recommended",
      "plugin:@typescript-eslint/recommended"
    ],
    "parserOptions": {
      "ecmaVersion": 2022,
      "sourceType": "module",
      "project": "./tsconfig.json"
    },
    "rules": {
      "no-console": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "warn"
    }
  }
  ```
- [ ] Add `.eslintignore`:
  ```
  node_modules
  dist
  coverage
  ```
- [ ] Run lint and fix issues: `npm run lint -- --fix`

---

## 🟢 Low Priority (Future Enhancements)

### 8. Add OpenAPI/Swagger Documentation
**Priority**: LOW
**Effort**: Medium (3-4 hours)
**Impact**: Better API documentation for consumers

#### Action Items:
- [ ] Install dependencies: `npm install swagger-jsdoc swagger-ui-express`
- [ ] Create OpenAPI spec file
- [ ] Add JSDoc comments to endpoints
- [ ] Add `/api-docs` endpoint
- [ ] Generate interactive API documentation

---

### 9. Add Rate Limiting
**Priority**: LOW
**Effort**: Low (2 hours)
**Impact**: Production protection against abuse

#### Action Items:
- [ ] Already have `express-rate-limit` installed (package.json:31)
- [ ] Configure rate limiter:
  ```typescript
  import rateLimit from 'express-rate-limit';

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP'
  });

  app.use('/api/', apiLimiter);
  ```

---

### 10. Add JSDoc Comments to Complex Functions
**Priority**: LOW
**Effort**: Medium (2-3 hours)
**Impact**: Better code understanding, IDE tooltips

#### Files to Document:
- `src/core/BrokerManager.ts` - `findBestBroker`, `subscribe`, etc.
- `src/brokers/OandaBroker.ts` - Connection and message handling logic
- All service methods

#### Example:
```typescript
/**
 * Finds the most appropriate broker for a given trading symbol
 *
 * Routing logic:
 * - Forex pairs (contains "/" but not crypto) → OANDA if available
 * - Cryptocurrency (BTC/ETH/USDT) → Binance if available
 * - Fallback → Any connected broker
 *
 * @param symbol - Trading symbol (e.g., "EUR/USD", "BTCUSDT")
 * @returns Broker instance or undefined if no brokers available
 */
private findBestBroker(symbol: string): BaseBroker | undefined {
  // ...
}
```

---

## 📊 Effort Summary

| Priority | Tasks | Total Effort | Impact |
|----------|-------|--------------|--------|
| 🔴 Critical | 1 | 15-25 hours | Very High |
| 🟠 High | 4 | 8-12 hours | High |
| 🟡 Medium | 3 | 3-4 hours | Medium |
| 🟢 Low | 3 | 7-9 hours | Low-Medium |
| **Total** | **11** | **33-50 hours** | |

---

## 🎯 Recommended Roadmap

### Sprint 1 (Week 1-2): Critical Foundation
- ✅ Code review completed
- [ ] Add comprehensive test suite (Item #1)
- [ ] Replace console.log with Pino (Item #2)

**Goal**: Production-ready with test coverage

### Sprint 2 (Week 3): High Priority Fixes
- [ ] Fix OandaBroker multi-symbol (Item #3)
- [ ] Sanitize logs (Item #4)
- [ ] Move hardcoded configs (Item #5)

**Goal**: Fix known bugs and security issues

### Sprint 3 (Week 4): Code Quality
- [ ] Add type annotations (Item #6)
- [ ] Add ESLint (Item #7)
- [ ] Run and fix all linting issues

**Goal**: Enforce code quality standards

### Future Sprints: Enhancements
- [ ] OpenAPI documentation (Item #8)
- [ ] Rate limiting (Item #9)
- [ ] JSDoc comments (Item #10)

**Goal**: Production hardening and documentation

---

## 📝 Notes

### Testing Strategy
Start with service layer tests (easiest ROI):
1. Services have clear inputs/outputs
2. No external dependencies when mocked
3. Business logic is isolated
4. High test coverage impact

Then move to integration tests:
1. API endpoint tests
2. Database integration
3. WebSocket flow tests

### Development Approach
For each improvement:
1. Create feature branch
2. Write tests first (TDD when possible)
3. Implement changes
4. Run full test suite
5. Update documentation
6. Create PR for review

---

**Generated**: 2025-01-25
**Next Review**: After Sprint 1 completion
**Status**: 🚀 Ready to begin
