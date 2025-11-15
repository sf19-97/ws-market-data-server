#!/usr/bin/env tsx
import { getHistoricalRates } from 'dukascopy-node';
import { writeFileSync } from 'fs';
import { join } from 'path';

console.log('🧪 Testing Dukascopy fetch for a missing day (Feb 26, 2024)...\n');

try {
  const data = await getHistoricalRates({
    instrument: 'eurusd',
    dates: {
      from: new Date('2024-02-26T00:00:00Z'),
      to: new Date('2024-02-26T23:59:59Z')
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

    // Convert to CSV
    const csvHeader = 'timestamp,datetime,askPrice,bidPrice,askVolume,bidVolume\n';
    const csvRows = data.map(tick => {
      const datetime = new Date(tick.timestamp).toISOString();
      return `${tick.timestamp},${datetime},${tick.askPrice},${tick.bidPrice},${tick.askVolume},${tick.bidVolume}`;
    }).join('\n');
    const csv = csvHeader + csvRows;

    // Save to file
    const filename = 'dukascopy-test-1hour.csv';
    const filepath = join(process.cwd(), filename);
    writeFileSync(filepath, csv, 'utf-8');

    console.log(`\n📄 Saved to: ${filepath}`);
    console.log(`📊 File size: ${(csv.length / 1024).toFixed(2)} KB`);
  } else {
    console.log('⚠️  No data returned (empty array)');
  }
} catch (error) {
  console.error('❌ Failed:', error);
}

process.exit(0);
