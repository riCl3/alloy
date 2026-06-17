import { parseUnifiedDiff, buildEnumeratedDiff } from '../../diffParser';
import { VectorStore, IndexedFunction } from '../../vectorStore';
import { deduplicateFindings } from '../../reviewGraph';
import { redactSensitiveText } from '../../redaction';
import { ReviewFinding } from '../../types';
import { benchmark, formatStats, BenchmarkResult } from './helpers/benchmarkRunner';

function generateLargeDiff(lineCount: number): string {
  const lines: string[] = ['--- a/src/file.ts', '+++ b/src/file.ts', `@@ -1,${lineCount} +1,${lineCount} @@`];
  for (let i = 0; i < lineCount; i++) {
    if (i % 10 === 0) {
      lines.push(`+export function func${i}() { return ${i}; }`);
    } else if (i % 15 === 0) {
      lines.push(`-const old${i} = ${i};`);
    } else if (i % 7 === 0) {
      lines.push(`+  if (condition${i}) { handleCase${i}(); }`);
    } else {
      lines.push(`  // context line ${i}: description of behavior`);
    }
  }
  return lines.join('\n');
}

function generateRandomEmbedding(dimension = 768): number[] {
  return Array.from({ length: dimension }, () => Math.random() * 2 - 1);
}

function generateRandomFunction(id: number): IndexedFunction {
  return {
    id: `func-${id}`,
    filePath: `src/file-${id % 100}.ts`,
    functionName: `function_${id}`,
    signature: `function function_${id}()`,
    functionBody: `function function_${id}() { return ${id}; }`,
    embedding: generateRandomEmbedding(),
  };
}

describe('Scalability Benchmarks', () => {
  const results: BenchmarkResult[] = [];

  afterAll(() => {
    const lines: string[] = [];
    lines.push('');
    lines.push('='.repeat(60));
    lines.push('  SCALABILITY BENCHMARKS');
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

  it('diff parsing at scale - 5000 lines', async () => {
    const diff = generateLargeDiff(5000);
    const stats = await benchmark(
      'parse 5000 lines',
      () => parseUnifiedDiff(diff, 'src/file.ts'),
      20,
    );
    results.push({ groupName: 'Diff Parsing Scale', stats: [stats] });
    expect(stats.median).toBeLessThan(500);
    console.log(`  5000 lines: ${stats.median.toFixed(2)}ms`);
  });

  it('diff parsing at scale - 10000 lines', async () => {
    const diff = generateLargeDiff(10000);
    const stats = await benchmark(
      'parse 10000 lines',
      () => parseUnifiedDiff(diff, 'src/file.ts'),
      10,
    );
    results[0].stats.push(stats);
    expect(stats.median).toBeLessThan(1000);
    console.log(`  10000 lines: ${stats.median.toFixed(2)}ms`);
  });

  it('enumerated diff at scale - 5000 lines', async () => {
    const diff = generateLargeDiff(5000);
    const parsed = parseUnifiedDiff(diff, 'src/file.ts');
    const stats = await benchmark(
      'enumerate 5000 lines',
      () => buildEnumeratedDiff(parsed),
      50,
    );
    results.push({ groupName: 'Enumerated Diff Scale', stats: [stats] });
    expect(stats.median).toBeLessThan(100);
    console.log(`  5000 lines: ${stats.median.toFixed(2)}ms`);
  });

  it('vector store query at scale - 10000 vectors', async () => {
    const store = new VectorStore();
    for (let i = 0; i < 10000; i++) {
      store.add(generateRandomFunction(i));
    }
    const query = generateRandomEmbedding();
    const stats = await benchmark(
      'query 10000 vectors',
      () => store.query(query, 5),
      20,
    );
    results.push({ groupName: 'Vector Store Scale', stats: [stats] });
    expect(stats.median).toBeLessThan(200);
    console.log(`  10000 vectors: ${stats.median.toFixed(2)}ms`);
  });

  it('deduplication at scale - 1000 findings', async () => {
    const findings: ReviewFinding[] = [];
    for (let i = 0; i < 1000; i++) {
      findings.push({
        line: (i % 100) + 1,
        severity: (['error', 'warning', 'info'] as const)[i % 3],
        message: `Finding ${i + 1} on line ${(i % 100) + 1}`,
        suggestion: `Fix ${i + 1}`,
        category: (['security', 'logic', 'quality', 'performance', 'test'] as const)[i % 5],
      });
    }
    const stats = await benchmark(
      'dedup 1000 findings',
      () => deduplicateFindings(findings),
      50,
    );
    results.push({ groupName: 'Dedup Scale', stats: [stats] });
    expect(stats.median).toBeLessThan(50);
    console.log(`  1000 findings: ${stats.median.toFixed(2)}ms`);
  });

  it('redaction at scale - 1MB', async () => {
    const largeCode = 'const x = 1;\n'.repeat(70000);
    const stats = await benchmark(
      'redact 1MB',
      () => redactSensitiveText(largeCode),
      10,
    );
    results.push({ groupName: 'Redaction Scale', stats: [stats] });
    expect(stats.median).toBeLessThan(1000);
    console.log(`  1MB: ${stats.median.toFixed(2)}ms`);
  });

  it('combined pipeline at scale - 5000 lines', async () => {
    const diff = generateLargeDiff(5000);
    const store = new VectorStore();
    for (let i = 0; i < 5000; i++) {
      store.add(generateRandomFunction(i));
    }
    const queryEmbedding = generateRandomEmbedding();

    const stats = await benchmark(
      'full pipeline 5000 lines',
      () => {
        const parsed = parseUnifiedDiff(diff, 'src/file.ts');
        const enumerated = buildEnumeratedDiff(parsed);
        redactSensitiveText(enumerated);
        store.query(queryEmbedding, 5);
        const findings: ReviewFinding[] = [];
        for (let i = 0; i < 50; i++) {
          findings.push({
            line: (i % 100) + 1,
            severity: 'warning',
            message: `Finding ${i}`,
            suggestion: `Fix ${i}`,
            category: 'logic',
          });
        }
        deduplicateFindings(findings);
      },
      10,
    );
    results.push({ groupName: 'Full Pipeline Scale', stats: [stats] });
    expect(stats.median).toBeLessThan(500);
    console.log(`  full pipeline 5000 lines: ${stats.median.toFixed(2)}ms`);
  });

  it('memory usage at scale', () => {
    const store = new VectorStore();
    for (let i = 0; i < 10000; i++) {
      store.add(generateRandomFunction(i));
    }
    const snapshot = store.snapshot();
    const jsonSize = JSON.stringify(snapshot).length;
    const estimatedMB = (jsonSize / 1024 / 1024).toFixed(2);
    console.log(`  10000 vectors memory: ~${estimatedMB}MB`);
    expect(jsonSize).toBeGreaterThan(0);
  });

  it('latency stability under repeated runs', async () => {
    const diff = generateLargeDiff(1000);
    const times: number[] = [];

    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      const parsed = parseUnifiedDiff(diff, 'src/file.ts');
      buildEnumeratedDiff(parsed);
      times.push(performance.now() - start);
    }

    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const maxDeviation = Math.max(...times.map((t) => Math.abs(t - mean)));
    const stability = mean > 0 ? ((1 - maxDeviation / mean) * 100).toFixed(1) : '0';

    console.log(`  Mean: ${mean.toFixed(2)}ms, Max deviation: ${maxDeviation.toFixed(2)}ms, Stability: ${stability}%`);
    expect(mean).toBeGreaterThan(0);
  });
});
