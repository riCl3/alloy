import { parseUnifiedDiff, buildEnumeratedDiff } from '../../diffParser';
import { getFunctionContext } from '../../astContext';
import { deduplicateFindings } from '../../reviewGraph';
import { buildReviewCacheKey, setCachedReview, getCachedReview, clearReviewCache } from '../../reviewCache';
import { redactSensitiveText } from '../../redaction';
import { benchmark, formatStats, BenchmarkResult } from './helpers/benchmarkRunner';

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

function createMockFindings(count: number): { line: number; severity: 'error' | 'warning' | 'info'; message: string; suggestion: string; category: 'security' | 'logic' | 'quality' | 'performance' | 'test' }[] {
  return Array.from({ length: count }, (_, i) => ({
    line: (i % 50) + 1,
    severity: (['error', 'warning', 'info'] as const)[i % 3],
    message: `Finding ${i + 1}`,
    suggestion: `Fix ${i + 1}`,
    category: (['security', 'logic', 'quality', 'performance', 'test'] as const)[i % 5],
  }));
}

describe('Latency Benchmarks (Full Pipeline Mock)', () => {
  const results: BenchmarkResult[] = [];

  afterAll(() => {
    const lines: string[] = [];
    lines.push('');
    lines.push('='.repeat(60));
    lines.push('  LATENCY BENCHMARKS (Pipeline without LLM)');
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

  it('pipeline: parse + redact + cache store (small diff)', async () => {
    const diff = generateDiff(100);
    const stats = await benchmark(
      'pipeline no-LLM (100 lines)',
      () => {
        const parsed = parseUnifiedDiff(diff, 'src/file.ts');
        const enumerated = buildEnumeratedDiff(parsed);
        redactSensitiveText(enumerated);
        const findings = createMockFindings(5);
        const key = buildReviewCacheKey('src/file.ts', diff, 'model', 'fast');
        setCachedReview('src/file.ts', key, findings);
      },
      200,
    );
    results.push({ groupName: 'No-LLM Pipeline', stats: [stats] });
    expect(stats.median).toBeLessThan(20);
    console.log(`  100 lines: ${stats.median.toFixed(2)}ms`);
  });

  it('pipeline: parse + redact + cache store (medium diff)', async () => {
    const diff = generateDiff(500);
    const stats = await benchmark(
      'pipeline no-LLM (500 lines)',
      () => {
        const parsed = parseUnifiedDiff(diff, 'src/file.ts');
        const enumerated = buildEnumeratedDiff(parsed);
        redactSensitiveText(enumerated);
        const findings = createMockFindings(10);
        const key = buildReviewCacheKey('src/file.ts', diff, 'model', 'fast');
        setCachedReview('src/file.ts', key, findings);
      },
      100,
    );
    results[0].stats.push(stats);
    expect(stats.median).toBeLessThan(50);
    console.log(`  500 lines: ${stats.median.toFixed(2)}ms`);
  });

  it('pipeline: parse + redact + cache store (large diff)', async () => {
    const diff = generateDiff(1000);
    const stats = await benchmark(
      'pipeline no-LLM (1000 lines)',
      () => {
        const parsed = parseUnifiedDiff(diff, 'src/file.ts');
        const enumerated = buildEnumeratedDiff(parsed);
        redactSensitiveText(enumerated);
        const findings = createMockFindings(20);
        const key = buildReviewCacheKey('src/file.ts', diff, 'model', 'fast');
        setCachedReview('src/file.ts', key, findings);
      },
      50,
    );
    results[0].stats.push(stats);
    expect(stats.median).toBeLessThan(100);
    console.log(`  1000 lines: ${stats.median.toFixed(2)}ms`);
  });

  it('pipeline: full with AST context', async () => {
    const sourceCode = `
function fetchData(url: string) {
  return fetch(url);
}

async function processAll(urls: string[]) {
  const results = [];
  for (const url of urls) {
    results.push(await fetchData(url));
  }
  return results;
}

export function main() {
  return processAll(['a', 'b', 'c']);
}`;
    const diff = generateDiff(50);
    const stats = await benchmark(
      'pipeline + AST context',
      async () => {
        const parsed = parseUnifiedDiff(diff, 'src/file.ts');
        const enumerated = buildEnumeratedDiff(parsed);
        await getFunctionContext(sourceCode, [5, 6, 7, 8, 9, 10, 11, 12], 'src/file.ts');
        redactSensitiveText(enumerated);
      },
      100,
    );
    results.push({ groupName: 'With AST Context', stats: [stats] });
    expect(stats.median).toBeLessThan(100);
    console.log(`  pipeline + AST: ${stats.median.toFixed(2)}ms`);
  });

  it('cache hit path latency', async () => {
    const diff = generateDiff(500);
    const findings = createMockFindings(15);
    const key = buildReviewCacheKey('src/file.ts', diff, 'model', 'fast');
    setCachedReview('src/file.ts', key, findings);

    const stats = await benchmark(
      'cache hit path',
      () => {
        const cacheKey = buildReviewCacheKey('src/file.ts', diff, 'model', 'fast');
        getCachedReview('src/file.ts', cacheKey);
      },
      10000,
    );
    results.push({ groupName: 'Cache Hit Path', stats: [stats] });
    expect(stats.median).toBeLessThan(0.5);
    console.log(`  cache hit: ${stats.median.toFixed(4)}ms`);
  });

  it('dedup + filter pipeline', async () => {
    const findings = createMockFindings(100);
    const modifiedLines = Array.from({ length: 30 }, (_, i) => i + 1);

    const stats = await benchmark(
      'dedup + filter (100 findings)',
      () => {
        const deduped = deduplicateFindings(findings);
        deduped.filter((f) => modifiedLines.includes(f.line));
      },
      200,
    );
    results.push({ groupName: 'Dedup + Filter', stats: [stats] });
    expect(stats.median).toBeLessThan(10);
    console.log(`  dedup + filter 100: ${stats.median.toFixed(2)}ms`);
  });

  it('redaction in pipeline context', async () => {
    const diff = generateDiff(500);
    const parsed = parseUnifiedDiff(diff, 'src/file.ts');
    const enumerated = buildEnumeratedDiff(parsed);
    const withSecrets = enumerated + '\nconst API_KEY = "sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234";';

    const stats = await benchmark(
      'redaction in pipeline (500 lines + secrets)',
      () => {
        redactSensitiveText(withSecrets);
        redactSensitiveText(withSecrets);
        redactSensitiveText(withSecrets);
        redactSensitiveText(withSecrets);
      },
      200,
    );
    results[0].stats.push(stats);
    expect(stats.median).toBeLessThan(20);
    console.log(`  4x redaction pipeline: ${stats.median.toFixed(2)}ms`);
  });
});
