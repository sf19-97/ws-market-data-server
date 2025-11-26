import 'dotenv/config';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

async function listR2Structure() {
  const client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  console.log('📂 R2 Bucket Structure for: data-lake\n');
  console.log('Fetching all objects...\n');

  let continuationToken: string | undefined;
  const structure = new Map<string, number>();
  let totalObjects = 0;

  do {
    const command = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME!,
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    });

    const response = await client.send(command);

    if (response.Contents) {
      for (const obj of response.Contents) {
        totalObjects++;
        // Extract directory structure
        const parts = obj.Key!.split('/');

        // Build hierarchical paths
        let path = '';
        for (let i = 0; i < parts.length - 1; i++) {
          path += (path ? '/' : '') + parts[i];
          structure.set(path, (structure.get(path) || 0) + 1);
        }
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  // Display structure in tree format
  const sortedPaths = Array.from(structure.keys()).sort();

  console.log('Directory Structure:\n');
  console.log('📦 data-lake/');

  // Group by top-level directories
  const topLevel = new Map<string, string[]>();

  for (const path of sortedPaths) {
    const parts = path.split('/');
    const root = parts[0];

    if (!topLevel.has(root)) {
      topLevel.set(root, []);
    }

    if (parts.length > 1) {
      topLevel.get(root)!.push(path);
    }
  }

  // Display each top-level directory
  for (const [root, paths] of topLevel) {
    const rootCount = structure.get(root) || 0;
    console.log(`├── ${root}/ (${rootCount} files)`);

    // Show some sample subdirectories
    const samples = paths.filter(p => p.split('/').length === 2).slice(0, 5);
    for (const sample of samples) {
      const count = structure.get(sample) || 0;
      const indent = '│   ';
      console.log(`${indent}├── ${sample.split('/')[1]}/ (${count} files)`);

      // Show deeper structure for first sample
      if (sample === samples[0]) {
        const deeper = paths.filter(p => p.startsWith(sample + '/') && p.split('/').length === 3).slice(0, 3);
        for (const deep of deeper) {
          const deepCount = structure.get(deep) || 0;
          console.log(`${indent}│   ├── ${deep.split('/')[2]}/ (${deepCount} files)`);

          // Show even deeper
          const evenDeeper = paths.filter(p => p.startsWith(deep + '/') && p.split('/').length === 4).slice(0, 2);
          for (const veryDeep of evenDeeper) {
            const veryDeepCount = structure.get(veryDeep) || 0;
            console.log(`${indent}│   │   ├── ${veryDeep.split('/')[3]}/ (${veryDeepCount} files)`);
          }
        }
      }
    }

    if (paths.filter(p => p.split('/').length === 2).length > 5) {
      console.log(`│   └── ... and ${paths.filter(p => p.split('/').length === 2).length - 5} more symbols`);
    }
  }

  console.log(`\n📊 Total objects: ${totalObjects}`);

  // Show specific samples
  console.log('\n📁 Sample full paths:');
  const samplePaths = sortedPaths
    .filter(p => p.includes('EURUSD') && p.includes('2024/03'))
    .slice(0, 5);

  for (const path of samplePaths) {
    console.log(`  - ${path}/ (${structure.get(path)} files)`);
  }
}

listR2Structure().catch(console.error);