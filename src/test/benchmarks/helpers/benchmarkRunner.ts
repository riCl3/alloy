export interface BenchmarkStats {
  name: string;
  iterations: number;
  median: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
  opsPerSec?: number;
  throughputPerSec?: number;
}

export interface BenchmarkResult {
  groupName: string;
  stats: BenchmarkStats[];
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export async function benchmark(
  name: string,
  fn: () => unknown | Promise<unknown>,
  iterations = 100,
): Promise<BenchmarkStats> {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);

  const stats: BenchmarkStats = {
    name,
    iterations,
    median: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    min: times[0],
    max: times[times.length - 1],
    mean: times.reduce((a, b) => a + b, 0) / times.length,
  };

  if (stats.median > 0) {
    stats.opsPerSec = 1000 / stats.median;
  }

  return stats;
}

export async function benchmarkWithThroughput(
  name: string,
  fn: () => unknown | Promise<unknown>,
  iterations: number,
  unitSize: number,
): Promise<BenchmarkStats> {
  const stats = await benchmark(name, fn, iterations);
  if (stats.median > 0) {
    stats.throughputPerSec = (unitSize / stats.median) * 1000;
  }
  return stats;
}

export function formatStats(stats: BenchmarkStats): string {
  const lines: string[] = [];
  lines.push(`  ${stats.name}:`);
  lines.push(`    median: ${stats.median.toFixed(2)}ms`);
  lines.push(`    p95:    ${stats.p95.toFixed(2)}ms`);
  lines.push(`    p99:    ${stats.p99.toFixed(2)}ms`);
  lines.push(`    min:    ${stats.min.toFixed(2)}ms`);
  lines.push(`    max:    ${stats.max.toFixed(2)}ms`);
  lines.push(`    mean:   ${stats.mean.toFixed(2)}ms`);
  if (stats.opsPerSec !== undefined) {
    lines.push(`    ops/s:  ${Math.round(stats.opsPerSec).toLocaleString()}`);
  }
  if (stats.throughputPerSec !== undefined) {
    lines.push(`    throughput: ${Math.round(stats.throughputPerSec).toLocaleString()} units/sec`);
  }
  lines.push(`    iterations: ${stats.iterations}`);
  return lines.join('\n');
}

export function formatReport(results: BenchmarkResult[]): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('='.repeat(60));
  lines.push('  ALLOY PERFORMANCE BENCHMARKS');
  lines.push('='.repeat(60));

  for (const result of results) {
    lines.push('');
  lines.push(`--- ${result.groupName} ---`);
    for (const stats of result.stats) {
      lines.push(formatStats(stats));
    }
  }

  lines.push('');
  lines.push('='.repeat(60));
  return lines.join('\n');
}

export function generateSummary(results: BenchmarkResult[]): string {
  const allStats = results.flatMap((r) => r.stats);
  const lines: string[] = [];
  lines.push('');
  lines.push('+'.repeat(60));
  lines.push('  MARKETING SUMMARY');
  lines.push('+'.repeat(60));

  for (const stats of allStats) {
    if (stats.throughputPerSec !== undefined) {
      lines.push(`  ${stats.name}: ${Math.round(stats.throughputPerSec).toLocaleString()} units/sec`);
    } else {
      lines.push(`  ${stats.name}: ${stats.median.toFixed(1)}ms (p50), ${stats.p95.toFixed(1)}ms (p95)`);
    }
  }

  lines.push('+'.repeat(60));
  return lines.join('\n');
}
