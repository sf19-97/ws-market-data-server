import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getR2Client } from './src/services/r2Client.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkMonths() {
  const r2 = getR2Client();
  if (!r2) {
    console.error('R2 not configured');
    process.exit(1);
  }

  const monthCounts: Record<string, number> = {};
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      Prefix: 'ticks/EURUSD/',
      ContinuationToken: continuationToken
    });

    const response = await r2.s3Client.send(command);

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (!obj.Key) continue;
        const parts = obj.Key.split('/');
        if (parts.length >= 4) {
          const monthKey = `${parts[2]}-${parts[3]}`;
          monthCounts[monthKey] = (monthCounts[monthKey] || 0) + 1;
        }
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  console.log('EURUSD files by month in R2:');
  console.log('============================');
  Object.keys(monthCounts).sort().forEach(month => {
    console.log(`${month}: ${monthCounts[month]} files`);
  });

  // Check for gaps
  console.log('\nMissing months:');
  const months = Object.keys(monthCounts).sort();
  if (months.length > 0) {
    const [startYear, startMonth] = months[0].split('-').map(Number);
    const [endYear, endMonth] = months[months.length - 1].split('-').map(Number);

    for (let y = startYear; y <= endYear; y++) {
      const mStart = (y === startYear) ? startMonth : 1;
      const mEnd = (y === endYear) ? endMonth : 12;

      for (let m = mStart; m <= mEnd; m++) {
        const monthKey = `${y}-${String(m).padStart(2, '0')}`;
        if (!monthCounts[monthKey]) {
          console.log(`  ${monthKey}: MISSING`);
        }
      }
    }
  }
}

checkMonths().catch(console.error);