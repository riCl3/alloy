import { parseUnifiedDiff, buildEnumeratedDiff } from '../../diffParser';
import { benchmarkWithThroughput, formatStats, BenchmarkResult } from './helpers/benchmarkRunner';

function generateDiff(lineCount: number): string {
  const lines: string[] = ['--- a/src/file.ts', '+++ b/src/file.ts', `@@ -1,${lineCount} +1,${lineCount} @@`];
  for (let i = 0; i < lineCount; i++) {
    if (i % 10 === 0) {
      lines.push(`+added line ${i}`);
    } else if (i % 15 === 0) {
      lines.push(`-removed line ${i}`);
    } else {
      lines.push(` context line ${i}`);
    }
  }
  return lines.join('\n');
}

function generateMultiHunkDiff(hunkCount: number, linesPerHunk: number): string {
  const lines: string[] = ['--- a/src/file.ts', '+++ b/src/file.ts'];
  for (let h = 0; h < hunkCount; h++) {
    const oldStart = h * linesPerHunk + 1;
    const newStart = h * linesPerHunk + 1;
    lines.push(`@@ -${oldStart},${linesPerHunk} +${newStart},${linesPerHunk} @@`);
    for (let i = 0; i < linesPerHunk; i++) {
      if (i % 5 === 0) {
        lines.push(`+added in hunk ${h} line ${i}`);
      } else {
        lines.push(` context in hunk ${h} line ${i}`);
      }
    }
  }
  return lines.join('\n');
}

describe('Diff Parsing Benchmarks', () => {
  const results: BenchmarkResult[] = [];

  afterAll(() => {
    const lines: string[] = [];
    lines.push('');
    lines.push('='.repeat(60));
    lines.push('  DIFF PARSING BENCHMARKS');
    lines.push('='.repeat(60));
    for (const result of results) {
      lines.push(`--- ${result.groupName} ---`);
      for (const stats of result.stats) {
        lines.push(formatStats(stats));
      }
    }
    lines.push('='.repeat(60));
    console.log(lines.join('\n'));
  });

  it('parseUnifiedDiff throughput - small diffs', async () => {
    const diff = generateDiff(100);
    const stats = await benchmarkWithThroughput(
      'parseUnifiedDiff (100 lines)',
      () => parseUnifiedDiff(diff, 'src/file.ts'),
      200,
      100,
    );
    results.push({ groupName: 'Parse Throughput', stats: [stats] });
    expect(stats.median).toBeLessThan(10);
    console.log(`  100 lines: ${stats.median.toFixed(2)}ms, ${Math.round(stats.throughputPerSec!).toLocaleString()} lines/sec`);
  });

  it('parseUnifiedDiff throughput - medium diffs', async () => {
    const diff = generateDiff(500);
    const stats = await benchmarkWithThroughput(
      'parseUnifiedDiff (500 lines)',
      () => parseUnifiedDiff(diff, 'src/file.ts'),
      100,
      500,
    );
    results[0].stats.push(stats);
    expect(stats.median).toBeLessThan(50);
    console.log(`  500 lines: ${stats.median.toFixed(2)}ms, ${Math.round(stats.throughputPerSec!).toLocaleString()} lines/sec`);
  });

  it('parseUnifiedDiff throughput - large diffs', async () => {
    const diff = generateDiff(1000);
    const stats = await benchmarkWithThroughput(
      'parseUnifiedDiff (1000 lines)',
      () => parseUnifiedDiff(diff, 'src/file.ts'),
      50,
      1000,
    );
    results[0].stats.push(stats);
    expect(stats.median).toBeLessThan(100);
    console.log(`  1000 lines: ${stats.median.toFixed(2)}ms, ${Math.round(stats.throughputPerSec!).toLocaleString()} lines/sec`);
  });

  it('parseUnifiedDiff throughput - extra large diffs', async () => {
    const diff = generateDiff(5000);
    const stats = await benchmarkWithThroughput(
      'parseUnifiedDiff (5000 lines)',
      () => parseUnifiedDiff(diff, 'src/file.ts'),
      20,
      5000,
    );
    results[0].stats.push(stats);
    expect(stats.median).toBeLessThan(500);
    console.log(`  5000 lines: ${stats.median.toFixed(2)}ms, ${Math.round(stats.throughputPerSec!).toLocaleString()} lines/sec`);
  });

  it('buildEnumeratedDiff throughput', async () => {
    const diff = generateDiff(500);
    const parsed = parseUnifiedDiff(diff, 'src/file.ts');
    const stats = await benchmarkWithThroughput(
      'buildEnumeratedDiff (500 lines)',
      () => buildEnumeratedDiff(parsed),
      200,
      500,
    );
    results.push({ groupName: 'Enumerated Diff', stats: [stats] });
    expect(stats.median).toBeLessThan(20);
    console.log(`  500 lines: ${stats.median.toFixed(2)}ms, ${Math.round(stats.throughputPerSec!).toLocaleString()} lines/sec`);
  });

  it('multi-hunk diff parsing', async () => {
    const diff = generateMultiHunkDiff(10, 50);
    const stats = await benchmarkWithThroughput(
      'parseUnifiedDiff (10 hunks x 50 lines)',
      () => parseUnifiedDiff(diff, 'src/file.ts'),
      100,
      500,
    );
    results.push({ groupName: 'Multi-Hunk', stats: [stats] });
    expect(stats.median).toBeLessThan(50);
    console.log(`  10 hunks x 50 lines: ${stats.median.toFixed(2)}ms`);
  });

  it('combined parse + enumerate pipeline', async () => {
    const diff = generateDiff(500);
    const stats = await benchmarkWithThroughput(
      'parse + enumerate (500 lines)',
      () => {
        const parsed = parseUnifiedDiff(diff, 'src/file.ts');
        buildEnumeratedDiff(parsed);
      },
      100,
      500,
    );
    results.push({ groupName: 'Full Pipeline', stats: [stats] });
    expect(stats.median).toBeLessThan(50);
    console.log(`  parse + enumerate 500 lines: ${stats.median.toFixed(2)}ms`);
  });
});
