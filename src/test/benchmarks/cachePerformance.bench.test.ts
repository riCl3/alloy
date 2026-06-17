import { buildReviewCacheKey, getCachedReview, setCachedReview, clearReviewCache } from '../../reviewCache';
import { benchmark, formatStats, BenchmarkResult } from './helpers/benchmarkRunner';

function createMockFindings(count: number): { line: number; severity: 'error' | 'warning' | 'info'; message: string; suggestion: string; category: 'security' | 'logic' | 'quality' | 'performance' | 'test' }[] {
  return Array.from({ length: count }, (_, i) => ({
    line: i + 1,
    severity: (['error', 'warning', 'info'] as const)[i % 3],
    message: `Finding ${i + 1}: test issue at line ${i + 1}`,
    suggestion: `Fix finding ${i + 1}`,
    category: (['security', 'logic', 'quality', 'performance', 'test'] as const)[i % 5],
  }));
}

describe('Cache Performance Benchmarks', () => {
  const results: BenchmarkResult[] = [];

  afterAll(() => {
    const lines: string[] = [];
    lines.push('');
    lines.push('='.repeat(60));
    lines.push('  CACHE PERFORMANCE BENCHMARKS');
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

  beforeEach(() => {
    clearReviewCache();
  });

  it('cache key generation', async () => {
    const diff = '--- a/file.ts\n+++ b/file.ts\n@@ -1,5 +1,5 @@\n-old\n+new';
    const stats = await benchmark(
      'buildReviewCacheKey',
      () => buildReviewCacheKey('src/file.ts', diff, 'gpt-4', 'fast'),
      10000,
    );
    results.push({ groupName: 'Cache Operations', stats: [stats] });
    expect(stats.median).toBeLessThan(0.1);
    console.log(`  key generation: ${stats.median.toFixed(4)}ms`);
  });

  it('cache set + get - 10 findings', async () => {
    const findings = createMockFindings(10);
    const key = buildReviewCacheKey('src/file.ts', 'diff', 'model', 'fast');
    const stats = await benchmark(
      'cache set+get (10 findings)',
      () => {
        setCachedReview('src/file.ts', key, findings);
        getCachedReview('src/file.ts', key);
      },
      10000,
    );
    results[0].stats.push(stats);
    expect(stats.median).toBeLessThan(0.5);
    console.log(`  set+get 10 findings: ${stats.median.toFixed(4)}ms`);
  });

  it('cache set + get - 50 findings', async () => {
    const findings = createMockFindings(50);
    const key = buildReviewCacheKey('src/file.ts', 'diff', 'model', 'fast');
    const stats = await benchmark(
      'cache set+get (50 findings)',
      () => {
        setCachedReview('src/file.ts', key, findings);
        getCachedReview('src/file.ts', key);
      },
      5000,
    );
    results[0].stats.push(stats);
    expect(stats.median).toBeLessThan(1);
    console.log(`  set+get 50 findings: ${stats.median.toFixed(4)}ms`);
  });

  it('cache hit vs miss comparison', async () => {
    const findings = createMockFindings(20);
    const key = buildReviewCacheKey('src/file.ts', 'diff', 'model', 'fast');
    setCachedReview('src/file.ts', key, findings);

    const hitStats = await benchmark(
      'cache HIT',
      () => getCachedReview('src/file.ts', key),
      10000,
    );

    const missStats = await benchmark(
      'cache MISS',
      () => getCachedReview('src/file.ts', 'wrong-key'),
      10000,
    );

    results.push({
      groupName: 'Hit vs Miss',
      stats: [hitStats, missStats],
    });

    const speedup = missStats.median / hitStats.median;
    console.log(`  Cache hit: ${hitStats.median.toFixed(4)}ms`);
    console.log(`  Cache miss: ${missStats.median.toFixed(4)}ms`);
    console.log(`  Speedup: ${speedup.toFixed(1)}x`);
    expect(hitStats.median).toBeGreaterThan(0);
  });

  it('cache LRU eviction at 200 entries', async () => {
    const findings = createMockFindings(5);
    const stats = await benchmark(
      'cache fill to 200 + eviction',
      () => {
        clearReviewCache();
        for (let i = 0; i < 201; i++) {
          const key = buildReviewCacheKey(`src/file-${i}.ts`, `diff-${i}`, 'model', 'fast');
          setCachedReview(`src/file-${i}.ts`, key, findings);
        }
      },
      50,
    );
    results[0].stats.push(stats);
    expect(stats.median).toBeLessThan(100);
    console.log(`  200 entries + eviction: ${stats.median.toFixed(3)}ms`);
  });

  it('cache correctness - returned findings are copies', () => {
    const findings = createMockFindings(5);
    const key = buildReviewCacheKey('src/file.ts', 'diff', 'model', 'fast');
    setCachedReview('src/file.ts', key, findings);

    const cached = getCachedReview('src/file.ts', key);
    expect(cached).toBeDefined();
    expect(cached).not.toBe(findings);
    expect(cached![0]).not.toBe(findings[0]);
    expect(cached![0]).toEqual(findings[0]);

    cached![0].message = 'modified';
    expect(findings[0].message).not.toBe('modified');
    console.log('  Cache returns deep copies: correct');
  });
});
