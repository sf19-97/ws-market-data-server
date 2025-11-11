#!/usr/bin/env tsx
import { getHistoricalRates } from 'dukascopy-node';

console.log('🧪 Testing Dukascopy fetch for 1 hour of data...\n');

try {
  const data = await getHistoricalRates({
    instrument: 'eurusd',
    dates: {
      from: new Date('2024-03-15T10:00:00Z'),
      to: new Date('2024-03-15T11:00:00Z')
    },
    timeframe: 'tick',
    format: 'json',
    batchSize: 1,
    pauseBetweenBatchesMs: 5000,
    useCache: true,
    retryOnEmpty: true,
    retryCount: 10,
    pauseBetweenRetriesMs: 10000,
    failAfterRetryCount: false
  });

  if (data && data.length > 0) {
    console.log(`✅ SUCCESS! Fetched ${data.length} ticks`);
    console.log('\nFirst tick:');
    console.log(data[0]);
    console.log('\nLast tick:');
    console.log(data[data.length - 1]);
  } else {
    console.log('⚠️  No data returned (empty array)');
  }
} catch (error) {
  console.error('❌ Failed:', error);
}

process.exit(0);
