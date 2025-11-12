/**
 * OpenAPI 3.0 Specification for Market Data Server REST API
 */
export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Market Data Server API',
    version: '1.0.0',
    description: `
All-Purpose WebSocket Market Data Server with REST API for historical data queries.

## Features
- Real-time market data streaming via WebSocket
- Historical OHLC candle data (1m, 5m, 15m, 1h, 4h, 12h timeframes)
- Symbol metadata and date range discovery
- Multi-broker support (Binance, OANDA)
- PostgreSQL-backed data persistence with materialized views

## Rate Limiting
- Health/Metrics endpoints: 300 requests per 15 minutes
- Metadata endpoint: 100 requests per 15 minutes
- Candles endpoint: 20 requests per 15 minutes (expensive queries)
    `,
    contact: {
      name: 'API Support'
    },
    license: {
      name: 'ISC'
    }
  },
  servers: [
    {
      url: 'http://localhost:8080',
      description: 'Development server'
    }
  ],
  tags: [
    {
      name: 'Health',
      description: 'Server health and monitoring endpoints'
    },
    {
      name: 'Metadata',
      description: 'Symbol discovery and metadata queries'
    },
    {
      name: 'Market Data',
      description: 'Historical OHLC candle data queries'
    }
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check endpoint',
        description: 'Returns server health status, client connections, and uptime',
        responses: {
          '200': {
            description: 'Server is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: {
                      type: 'string',
                      example: 'healthy'
                    },
                    clients: {
                      type: 'number',
                      description: 'Number of connected WebSocket clients',
                      example: 5
                    },
                    uptime: {
                      type: 'number',
                      description: 'Server uptime in seconds',
                      example: 3600.5
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/metrics': {
      get: {
        tags: ['Health'],
        summary: 'Server metrics endpoint',
        description: 'Returns server performance metrics and subscription counts',
        responses: {
          '200': {
            description: 'Server metrics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    connections: {
                      type: 'number',
                      description: 'Number of active WebSocket connections',
                      example: 5
                    },
                    subscriptions: {
                      type: 'number',
                      description: 'Total number of symbol subscriptions across all clients',
                      example: 12
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/metadata': {
      get: {
        tags: ['Metadata'],
        summary: 'Get symbol metadata',
        description: `
Get metadata for all available symbols or a specific symbol.

Without query parameters, returns a list of all available symbols with their date ranges and tick counts.
With a symbol parameter, returns detailed metadata for that specific symbol including available timeframes.
        `,
        parameters: [
          {
            in: 'query',
            name: 'symbol',
            schema: {
              type: 'string',
              pattern: '^[A-Z]{6}$',
              example: 'EURUSD'
            },
            required: false,
            description: 'Specific symbol to get metadata for (6 uppercase letters, no slash)'
          }
        ],
        responses: {
          '200': {
            description: 'Symbol metadata retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    {
                      // List of all symbols
                      type: 'object',
                      properties: {
                        symbols: {
                          type: 'array',
                          items: {
                            $ref: '#/components/schemas/SymbolMetadata'
                          }
                        },
                        timeframes: {
                          type: 'array',
                          items: {
                            type: 'string',
                            enum: ['1m', '5m', '15m', '1h', '4h', '12h']
                          },
                          example: ['1m', '5m', '15m', '1h', '4h', '12h']
                        }
                      }
                    },
                    {
                      // Single symbol metadata
                      $ref: '#/components/schemas/SymbolMetadata'
                    }
                  ]
                }
              }
            }
          },
          '400': {
            $ref: '#/components/responses/ValidationError'
          },
          '404': {
            $ref: '#/components/responses/SymbolNotFound'
          },
          '429': {
            $ref: '#/components/responses/RateLimitExceeded'
          }
        }
      }
    },
    '/api/candles': {
      get: {
        tags: ['Market Data'],
        summary: 'Get historical OHLC candle data',
        description: `
Query historical OHLC (Open, High, Low, Close) candle data for a specific symbol and timeframe.

## Timeframes
- \`1m\`: 1 minute (aggregated from raw ticks)
- \`5m, 15m, 1h, 4h, 12h\`: Pre-computed using materialized views for fast queries

## Date Range Limits
- Maximum range: 1 year (365 days)
- Timestamps must be in Unix epoch seconds
- The \`from\` timestamp must be before \`to\` timestamp

## Performance
Queries use PostgreSQL materialized views for 5m+ timeframes, providing sub-second response times.
Results are cached with ETag support for efficient re-queries.
        `,
        parameters: [
          {
            in: 'query',
            name: 'symbol',
            required: true,
            schema: {
              type: 'string',
              pattern: '^[A-Z]{6}$',
              example: 'EURUSD'
            },
            description: 'Symbol to query (6 uppercase letters, no slash)'
          },
          {
            in: 'query',
            name: 'timeframe',
            required: false,
            schema: {
              type: 'string',
              enum: ['1m', '5m', '15m', '1h', '4h', '12h'],
              default: '1h'
            },
            description: 'Candle timeframe (defaults to 1h)'
          },
          {
            in: 'query',
            name: 'from',
            required: true,
            schema: {
              type: 'integer',
              example: 1704067200
            },
            description: 'Start timestamp (Unix epoch seconds)'
          },
          {
            in: 'query',
            name: 'to',
            required: true,
            schema: {
              type: 'integer',
              example: 1704153600
            },
            description: 'End timestamp (Unix epoch seconds)'
          }
        ],
        responses: {
          '200': {
            description: 'OHLC candle data retrieved successfully',
            headers: {
              'ETag': {
                schema: {
                  type: 'string'
                },
                description: 'Cache validation tag'
              },
              'Cache-Control': {
                schema: {
                  type: 'string'
                },
                description: 'Cache control directives'
              }
            },
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    $ref: '#/components/schemas/Candle'
                  }
                },
                example: [
                  {
                    time: 1704067200,
                    open: 1.09500,
                    high: 1.09650,
                    low: 1.09400,
                    close: 1.09550
                  },
                  {
                    time: 1704070800,
                    open: 1.09550,
                    high: 1.09700,
                    low: 1.09500,
                    close: 1.09650
                  }
                ]
              }
            }
          },
          '304': {
            description: 'Not modified - cached data is still valid'
          },
          '400': {
            $ref: '#/components/responses/ValidationError'
          },
          '404': {
            $ref: '#/components/responses/SymbolNotFound'
          },
          '429': {
            $ref: '#/components/responses/RateLimitExceeded'
          }
        }
      }
    }
  },
  components: {
    schemas: {
      SymbolMetadata: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            example: 'EURUSD',
            description: 'Symbol identifier (6 uppercase letters)'
          },
          earliest: {
            type: 'integer',
            example: 1704067200,
            description: 'Earliest available data timestamp (Unix epoch seconds)'
          },
          latest: {
            type: 'integer',
            example: 1735689600,
            description: 'Latest available data timestamp (Unix epoch seconds)'
          },
          tick_count: {
            type: 'integer',
            example: 1000000,
            description: 'Total number of ticks in database for this symbol'
          },
          timeframes: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['1m', '5m', '15m', '1h', '4h', '12h']
            },
            example: ['1m', '5m', '15m', '1h', '4h', '12h'],
            description: 'Available timeframes for this symbol'
          }
        },
        required: ['symbol', 'earliest', 'latest', 'tick_count', 'timeframes']
      },
      Candle: {
        type: 'object',
        properties: {
          time: {
            type: 'integer',
            example: 1704067200,
            description: 'Candle timestamp (Unix epoch seconds)'
          },
          open: {
            type: 'number',
            format: 'double',
            example: 1.09500,
            description: 'Opening price (5 decimal places)'
          },
          high: {
            type: 'number',
            format: 'double',
            example: 1.09650,
            description: 'Highest price (5 decimal places)'
          },
          low: {
            type: 'number',
            format: 'double',
            example: 1.09400,
            description: 'Lowest price (5 decimal places)'
          },
          close: {
            type: 'number',
            format: 'double',
            example: 1.09550,
            description: 'Closing price (5 decimal places)'
          }
        },
        required: ['time', 'open', 'high', 'low', 'close']
      },
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'string',
            description: 'Error message'
          },
          code: {
            type: 'string',
            description: 'Error code for programmatic handling'
          },
          details: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: {
                  type: 'string',
                  description: 'Field that failed validation'
                },
                message: {
                  type: 'string',
                  description: 'Validation error message'
                }
              }
            },
            description: 'Detailed validation errors (for validation failures)'
          }
        },
        required: ['error', 'code']
      }
    },
    responses: {
      ValidationError: {
        description: 'Validation error - invalid query parameters',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error'
            },
            example: {
              error: 'Validation failed',
              code: 'VALIDATION_ERROR',
              details: [
                {
                  field: 'symbol',
                  message: 'Symbol must be exactly 6 uppercase letters without slashes'
                }
              ]
            }
          }
        }
      },
      SymbolNotFound: {
        description: 'Symbol not found in database',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error'
            },
            example: {
              error: 'Symbol not found',
              code: 'SYMBOL_NOT_FOUND'
            }
          }
        }
      },
      RateLimitExceeded: {
        description: 'Too many requests - rate limit exceeded',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error'
            },
            example: {
              error: 'Too many requests from this IP, please try again later',
              code: 'RATE_LIMIT_EXCEEDED'
            }
          }
        }
      }
    }
  }
};
