import 'dotenv/config';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

async function checkR2Structure() {
  const client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  console.log('🔍 Checking R2 bucket structure...\n');

  // Check for both ticks and candles
  const prefixes = ['ticks/', 'candles/'];

  for (const prefix of prefixes) {
    const command = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME!,
      Prefix: prefix,
      MaxKeys: 10,
    });

    try {
      const response = await client.send(command);
      const count = response.KeyCount || 0;
      console.log(`${prefix}: ${count > 0 ? '✅' : '❌'} Found ${count} files`);

      if (count > 0 && response.Contents) {
        console.log(`  Sample files:`);
        response.Contents.slice(0, 3).forEach(obj => {
          console.log(`    - ${obj.Key} (${(obj.Size! / 1024).toFixed(1)} KB)`);
        });
      }
    } catch (error) {
      console.log(`${prefix}: ❌ Error: ${error.message}`);
    }
  }

  // Check specific EURUSD candles for March 2024
  console.log('\n📊 Checking EURUSD March 2024 candles specifically:');
  const marchCommand = new ListObjectsV2Command({
    Bucket: process.env.R2_BUCKET_NAME!,
    Prefix: 'candles/EURUSD/2024/03/',
    MaxKeys: 100,
  });

  const marchResponse = await client.send(marchCommand);
  console.log(`  Found ${marchResponse.KeyCount || 0} candle files for March 2024`);

  // Check EURUSD ticks for comparison
  const tickCommand = new ListObjectsV2Command({
    Bucket: process.env.R2_BUCKET_NAME!,
    Prefix: 'ticks/EURUSD/2024/03/',
    MaxKeys: 100,
  });

  const tickResponse = await client.send(tickCommand);
  console.log(`  Found ${tickResponse.KeyCount || 0} tick files for March 2024`);

  // Summary
  console.log('\n📋 Summary:');
  if (marchResponse.KeyCount === 0 && tickResponse.KeyCount! > 0) {
    console.log('  ⚠️  Ticks exist but NO candles - data was imported with old version!');
    console.log('  💡 Solution: Re-import data or build candles from existing ticks');
  } else if (marchResponse.KeyCount! > 0) {
    console.log('  ✅ Candles exist in R2 - materialization should work!');
  }
}

checkR2Structure().catch(console.error);