import { parseUnifiedDiff, buildEnumeratedDiff } from '../../diffParser';
import { redactSensitiveText } from '../../redaction';
import { VectorStore } from '../../vectorStore';
import { deduplicateFindings } from '../../reviewGraph';
import { buildReviewCacheKey, setCachedReview, getCachedReview, clearReviewCache } from '../../reviewCache';
import { RateLimiter } from '../../rateLimiter';
import { ReviewFinding } from '../../types';
import { benchmark, BenchmarkStats } from './helpers/benchmarkRunner';

function generateDiff(lineCount: number): string {
  const lines: string[] = ['--- a/src/file.ts', '+++ b/src/file.ts', `@@ -1,${lineCount} +1,${lineCount} @@`];
  for (let i = 0; i < lineCount; i++) {
    if (i % 10 === 0) {
      lines.push(`+export function func${i}() { return ${i}; }`);
    } else if (i % 15 === 0) {
      lines.push(`-const old${i} = ${i};`);
    } else {
      lines.push(`  // context line ${i}`);
    }
  }
  return lines.join('\n');
}

function createMockFindings(count: number): ReviewFinding[] {
  return Array.from({ length: count }, (_, i) => ({
    line: (i % 50) + 1,
    severity: (['error', 'warning', 'info'] as const)[i % 3],
    message: `Finding ${i + 1}`,
    suggestion: `Fix ${i + 1}`,
    category: (['security', 'logic', 'quality', 'performance', 'test'] as const)[i % 5],
  }));
}

function generateRandomEmbedding(dimension = 768): number[] {
  return Array.from({ length: dimension }, () => Math.random() * 2 - 1);
}

describe('Summary Benchmarks', () => {
  const allStats: BenchmarkStats[] = [];

  afterAll(() => {
    const lines: string[] = [];
    lines.push('');
    lines.push('+'.repeat(60));
    lines.push('  ALLOY MARKETING SUMMARY');
    lines.push('+'.repeat(60));

    lines.push('');
    lines.push('--- Speed Claims ---');
    const speedStats = allStats.filter((s) =>
      s.name.includes('parse') || s.name.includes('pipeline') || s.name.includes('redact'),
    );
    for (const stats of speedStats) {
      lines.push(`  ${stats.name}: ${stats.median.toFixed(1)}ms (p50), ${stats.p95.toFixed(1)}ms (p95)`);
    }

    lines.push('');
    lines.push('--- Throughput Claims ---');
    const throughputStats = allStats.filter((s) => s.throughputPerSec !== undefined);
    for (const stats of throughputStats) {
      lines.push(`  ${stats.name}: ${Math.round(stats.throughputPerSec!).toLocaleString()} units/sec`);
    }

    lines.push('');
    lines.push('--- Scale Claims ---');
    const scaleStats = allStats.filter((s) =>
      s.name.includes('10000') || s.name.includes('1000') || s.name.includes('5000'),
    );
    for (const stats of scaleStats) {
      lines.push(`  ${stats.name}: ${stats.median.toFixed(1)}ms`);
    }

    lines.push('');
    lines.push('--- Efficiency Claims ---');
    const cacheHit = allStats.find((s) => s.name === 'cache HIT');
    const cacheMiss = allStats.find((s) => s.name === 'cache MISS');
    if (cacheHit && cacheMiss) {
      const speedup = (cacheMiss.median / cacheHit.median).toFixed(0);
      lines.push(`  Cache speedup: ${speedup}x faster (${cacheHit.median.toFixed(2)}ms vs ${cacheMiss.median.toFixed(1)}ms)`);
    }

    const dedupStats = allStats.find((s) => s.name.includes('dedup'));
    if (dedupStats) {
      lines.push(`  Deduplication: ${dedupStats.median.toFixed(1)}ms for 100 findings`);
    }

    lines.push('');
    lines.push('+'.repeat(60));
    lines.push('  Copy these numbers into your marketing materials.');
    lines.push('+'.repeat(60));
    console.log(lines.join('\n'));
  });

  it('collect all benchmark metrics', async () => {
    clearReviewCache();

    const diff100 = generateDiff(100);
    const diff500 = generateDiff(500);
    const diff1000 = generateDiff(1000);

    allStats.push(await benchmark('parse 100 lines', () => parseUnifiedDiff(diff100, 'src/file.ts'), 200));
    allStats.push(await benchmark('parse 500 lines', () => parseUnifiedDiff(diff500, 'src/file.ts'), 100));
    allStats.push(await benchmark('parse 1000 lines', () => parseUnifiedDiff(diff1000, 'src/file.ts'), 50));

    const parsed500 = parseUnifiedDiff(diff500, 'src/file.ts');
    buildEnumeratedDiff(parsed500);
    allStats.push(await benchmark('enumerate 500 lines', () => buildEnumeratedDiff(parsed500), 200));

    allStats.push(await benchmark('redact 10KB', () => redactSensitiveText('const x = 1;\n'.repeat(700)), 200));

    const findings50 = createMockFindings(50);
    const findings100 = createMockFindings(100);
    allStats.push(await benchmark('dedup 50 findings', () => deduplicateFindings(findings50), 500));
    allStats.push(await benchmark('dedup 100 findings', () => deduplicateFindings(findings100), 200));

    const store = new VectorStore();
    for (let i = 0; i < 1000; i++) {
      store.add({
        id: `f-${i}`, filePath: `src/${i}.ts`, functionName: `fn${i}`,
        signature: `fn${i}()`, functionBody: `fn${i}(){}`, embedding: generateRandomEmbedding(),
      });
    }
    const query = generateRandomEmbedding();
    allStats.push(await benchmark('vector query 1000', () => store.query(query, 5), 100));

    clearReviewCache();
    const key = buildReviewCacheKey('src/file.ts', diff500, 'model', 'fast');
    setCachedReview('src/file.ts', key, findings50);
    allStats.push(await benchmark('cache HIT', () => getCachedReview('src/file.ts', key), 10000));
    allStats.push(await benchmark('cache MISS', () => getCachedReview('src/file.ts', 'wrong'), 10000));

    allStats.push(await benchmark('full pipeline no-LLM (500 lines)', () => {
      const parsed = parseUnifiedDiff(diff500, 'src/file.ts');
      const enumerated = buildEnumeratedDiff(parsed);
      redactSensitiveText(enumerated);
      const f = createMockFindings(10);
      const k = buildReviewCacheKey('src/file.ts', diff500, 'model', 'fast');
      setCachedReview('src/file.ts', k, f);
    }, 100));

    const limiter = new RateLimiter(5);
    await Promise.all(Array.from({ length: 10 }, () => limiter.run(() => Promise.resolve())));

    expect(allStats.length).toBeGreaterThan(5);
  });
});
