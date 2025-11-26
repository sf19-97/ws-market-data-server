import 'dotenv/config';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

async function checkCandles() {
  const client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  console.log('📊 EURUSD Candle Files in R2:\n');

  const command = new ListObjectsV2Command({
    Bucket: process.env.R2_BUCKET_NAME!,
    Prefix: 'candles/EURUSD/',
    MaxKeys: 100,
  });

  const response = await client.send(command);

  if (response.Contents && response.Contents.length > 0) {
    // Group by date
    const dateMap = new Map<string, number>();

    response.Contents.forEach(obj => {
      const match = obj.Key!.match(/candles\/EURUSD\/(\d{4})\/(\d{2})\/(\d{2})\//);
      if (match) {
        const date = `${match[1]}-${match[2]}-${match[3]}`;
        dateMap.set(date, (dateMap.get(date) || 0) + 1);
      }
    });

    // Sort and display
    const sortedDates = Array.from(dateMap.keys()).sort();
    sortedDates.forEach(date => {
      console.log(`  ${date}: ${dateMap.get(date)} files`);
    });

    console.log(`\n✅ Total: ${response.Contents.length} candle files`);
    console.log(`📅 Date range: ${sortedDates[0]} to ${sortedDates[sortedDates.length - 1]}`);
  } else {
    console.log('❌ No EURUSD candle files found');
  }

  // Check for the date offset issue
  console.log('\n⚠️  Note: There appears to be a date offset bug.');
  console.log('    Candles may be stored 1 day earlier than expected.');
}

checkCandles().catch(console.error);