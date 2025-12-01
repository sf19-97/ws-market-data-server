#!/usr/bin/env tsx
/**
 * Analyze command - Analyzes R2 bucket to get statistics about stored tick data
 *
 * Usage:
 *   npx tsx src/cli/commands/analyze.ts [--sample] [--output=<file>]
 *
 * Examples:
 *   npx tsx src/cli/commands/analyze.ts
 *   npx tsx src/cli/commands/analyze.ts --sample
 *   npx tsx src/cli/commands/analyze.ts --output=r2-stats.json
 */
import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import dotenv from 'dotenv';
import { getR2Client } from '../../services/r2Client.js';

dotenv.config();

interface SymbolStats {
  symbol: string;
  fileCount: number;
  totalSize: number;
  dateRange: {
    earliest: Date;
    latest: Date;
  };
  filesByMonth: Map<string, number>;
  estimatedTicks: number;
}

/**
 * Analyze R2 bucket to get comprehensive statistics about stored tick data
 */
export class R2Analyzer {
  private r2Client = getR2Client();
  private stats = new Map<string, SymbolStats>();

  constructor() {
    if (!this.r2Client) {
      throw new Error('R2 client not configured. Set R2 credentials in environment.');
    }
  }

  async listAllObjects(): Promise<void> {
    console.log('🔍 Scanning R2 bucket for tick data...\n');

    let continuationToken: string | undefined;
    let totalObjects = 0;
    let totalSize = 0;

    do {
      const command = new ListObjectsV2Command({
        Bucket: 'data-lake',
        Prefix: 'ticks/',
        ContinuationToken: continuationToken,
        MaxKeys: 1000
      });

      try {
        const response = await this.r2Client!.s3Client.send(command);

        if (response.Contents) {
          for (const object of response.Contents) {
            if (object.Key) {
              this.processObject(object.Key, object.Size || 0);
              totalObjects++;
              totalSize += object.Size || 0;
            }
          }
        }

        continuationToken = response.NextContinuationToken;
      } catch (error: any) {
        console.error('❌ Error listing objects:', error.message);
        break;
      }
    } while (continuationToken);

    console.log(`\n✅ Scanned ${totalObjects} objects (${this.formatBytes(totalSize)})\n`);
  }

  private processObject(key: string, size: number): void {
    const parts = key.split('/');
    if (parts.length !== 6 || parts[0] !== 'ticks') return;

    const symbol = parts[1];
    const year = parts[2];
    const month = parts[3];
    const day = parts[4];

    if (!this.stats.has(symbol)) {
      this.stats.set(symbol, {
        symbol,
        fileCount: 0,
        totalSize: 0,
        dateRange: {
          earliest: new Date(3000, 0, 1),
          latest: new Date(1970, 0, 1)
        },
        filesByMonth: new Map(),
        estimatedTicks: 0
      });
    }

    const stats = this.stats.get(symbol)!;
    stats.fileCount++;
    stats.totalSize += size;

    const date = new Date(parseInt(year), parseInt(month), parseInt(day));
    if (date < stats.dateRange.earliest) stats.dateRange.earliest = date;
    if (date > stats.dateRange.latest) stats.dateRange.latest = date;

    const monthKey = `${year}-${month.padStart(2, '0')}`;
    stats.filesByMonth.set(monthKey, (stats.filesByMonth.get(monthKey) || 0) + 1);

    stats.estimatedTicks = stats.fileCount * 100000;
  }

  async sampleFiles(symbol: string, count: number = 2): Promise<number> {
    const command = new ListObjectsV2Command({
      Bucket: 'data-lake',
      Prefix: `ticks/${symbol}/`,
      MaxKeys: count
    });

    try {
      const response = await this.r2Client!.s3Client.send(command);

      if (!response.Contents || response.Contents.length === 0) {
        return 0;
      }

      let totalTicks = 0;
      let sampledFiles = 0;

      for (const object of response.Contents.slice(0, count)) {
        if (object.Key) {
          const getCommand = new GetObjectCommand({
            Bucket: 'data-lake',
            Key: object.Key
          });

          const data = await this.r2Client!.s3Client.send(getCommand);
          const body = await data.Body?.transformToString();

          if (body) {
            const ticks = JSON.parse(body);
            totalTicks += ticks.length;
            sampledFiles++;
          }
        }
      }

      return sampledFiles > 0 ? Math.round(totalTicks / sampledFiles) : 0;
    } catch (error: any) {
      console.error(`❌ Error sampling files for ${symbol}:`, error.message);
      return 0;
    }
  }

  async displayResults(sample: boolean = false): Promise<void> {
    console.log('📊 R2 Data Lake Analysis');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    const sortedSymbols = Array.from(this.stats.keys()).sort();

    console.log('Symbol    Files   Date Range                          Storage     Est. Ticks');
    console.log('───────   ─────   ─────────────────────────────────   ─────────   ──────────');

    let totalFiles = 0;
    let totalStorage = 0;
    let totalTicks = 0;

    for (const symbol of sortedSymbols) {
      const stats = this.stats.get(symbol)!;

      if (sample) {
        const avgTicksPerFile = await this.sampleFiles(symbol);
        if (avgTicksPerFile > 0) {
          stats.estimatedTicks = stats.fileCount * avgTicksPerFile;
        }
      }

      const dateRange = `${this.formatDate(stats.dateRange.earliest)} → ${this.formatDate(stats.dateRange.latest)}`;

      console.log(
        `${symbol.padEnd(9)} ${stats.fileCount.toString().padStart(5)}   ${dateRange.padEnd(35)} ${this.formatBytes(stats.totalSize).padStart(10)}   ${this.formatNumber(stats.estimatedTicks)}`
      );

      totalFiles += stats.fileCount;
      totalStorage += stats.totalSize;
      totalTicks += stats.estimatedTicks;
    }

    console.log('───────   ─────   ─────────────────────────────────   ─────────   ──────────');
    console.log(
      `${'TOTAL'.padEnd(9)} ${totalFiles.toString().padStart(5)}   ${' '.repeat(35)} ${this.formatBytes(totalStorage).padStart(10)}   ${this.formatNumber(totalTicks)}`
    );

    console.log('\n📈 Summary:');
    console.log(`  • Symbols: ${sortedSymbols.length}`);
    console.log(`  • Total Files: ${totalFiles.toLocaleString()}`);
    console.log(`  • Total Storage: ${this.formatBytes(totalStorage)}`);
    console.log(`  • Estimated Ticks: ${this.formatNumber(totalTicks)}`);

    console.log('\n📅 Monthly Breakdown:');
    for (const symbol of sortedSymbols) {
      const stats = this.stats.get(symbol)!;
      console.log(`\n  ${symbol}:`);

      const sortedMonths = Array.from(stats.filesByMonth.keys()).sort();
      for (const month of sortedMonths) {
        const count = stats.filesByMonth.get(month)!;
        console.log(`    ${month}: ${count} files`);
      }
    }
  }

  exportToJson(filename: string): void {
    const data = {
      timestamp: new Date().toISOString(),
      summary: {
        totalSymbols: this.stats.size,
        totalFiles: Array.from(this.stats.values()).reduce((sum, s) => sum + s.fileCount, 0),
        totalStorage: Array.from(this.stats.values()).reduce((sum, s) => sum + s.totalSize, 0),
        estimatedTicks: Array.from(this.stats.values()).reduce((sum, s) => sum + s.estimatedTicks, 0)
      },
      symbols: Object.fromEntries(
        Array.from(this.stats.entries()).map(([symbol, stats]) => [
          symbol,
          {
            fileCount: stats.fileCount,
            totalSize: stats.totalSize,
            dateRange: {
              earliest: this.formatDate(stats.dateRange.earliest),
              latest: this.formatDate(stats.dateRange.latest)
            },
            filesByMonth: Object.fromEntries(stats.filesByMonth),
            estimatedTicks: stats.estimatedTicks
          }
        ])
      )
    };

    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
    console.log(`\n💾 Results exported to ${filename}`);
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  private formatNumber(num: number): string {
    if (num < 1000) return num.toString();
    if (num < 1000000) return `${(num / 1000).toFixed(1)}K`;
    return `${(num / 1000000).toFixed(1)}M`;
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}

async function main() {
  const args = process.argv.slice(2);
  const sample = args.includes('--sample');
  const outputFile = args.find(arg => arg.startsWith('--output='))?.split('=')[1];

  const analyzer = new R2Analyzer();

  try {
    await analyzer.listAllObjects();
    await analyzer.displayResults(sample);

    if (outputFile) {
      analyzer.exportToJson(outputFile);
    }
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
