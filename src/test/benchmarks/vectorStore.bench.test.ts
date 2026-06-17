import { VectorStore, cosineSimilarity, IndexedFunction } from '../../vectorStore';
import { benchmark, formatStats, BenchmarkResult } from './helpers/benchmarkRunner';

function generateRandomEmbedding(dimension = 768): number[] {
  const embedding: number[] = [];
  for (let i = 0; i < dimension; i++) {
    embedding.push(Math.random() * 2 - 1);
  }
  return embedding;
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

describe('Vector Store Benchmarks', () => {
  const results: BenchmarkResult[] = [];

  afterAll(() => {
    const lines: string[] = [];
    lines.push('');
    lines.push('='.repeat(60));
    lines.push('  VECTOR STORE BENCHMARKS');
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

  it('cosineSimilarity - 768-dim vectors', async () => {
    const a = generateRandomEmbedding(768);
    const b = generateRandomEmbedding(768);
    const stats = await benchmark(
      'cosineSimilarity (768-dim)',
      () => cosineSimilarity(a, b),
      10000,
    );
    results.push({ groupName: 'Cosine Similarity', stats: [stats] });
    expect(stats.median).toBeLessThan(0.01);
    console.log(`  768-dim: ${stats.median.toFixed(4)}ms`);
  });

  it('VectorStore.query - 100 vectors', async () => {
    const store = new VectorStore();
    for (let i = 0; i < 100; i++) {
      store.add(generateRandomFunction(i));
    }
    const query = generateRandomEmbedding();
    const stats = await benchmark(
      'VectorStore.query (100 vectors)',
      () => store.query(query, 5),
      500,
    );
    results.push({ groupName: 'Query Latency', stats: [stats] });
    expect(stats.median).toBeLessThan(5);
    console.log(`  100 vectors: ${stats.median.toFixed(3)}ms`);
  });

  it('VectorStore.query - 1000 vectors', async () => {
    const store = new VectorStore();
    for (let i = 0; i < 1000; i++) {
      store.add(generateRandomFunction(i));
    }
    const query = generateRandomEmbedding();
    const stats = await benchmark(
      'VectorStore.query (1000 vectors)',
      () => store.query(query, 5),
      200,
    );
    results[0].stats.push(stats);
    expect(stats.median).toBeLessThan(20);
    console.log(`  1000 vectors: ${stats.median.toFixed(3)}ms`);
  });

  it('VectorStore.query - 5000 vectors', async () => {
    const store = new VectorStore();
    for (let i = 0; i < 5000; i++) {
      store.add(generateRandomFunction(i));
    }
    const query = generateRandomEmbedding();
    const stats = await benchmark(
      'VectorStore.query (5000 vectors)',
      () => store.query(query, 5),
      50,
    );
    results[0].stats.push(stats);
    expect(stats.median).toBeLessThan(100);
    console.log(`  5000 vectors: ${stats.median.toFixed(3)}ms`);
  });

  it('VectorStore.query - 10000 vectors', async () => {
    const store = new VectorStore();
    for (let i = 0; i < 10000; i++) {
      store.add(generateRandomFunction(i));
    }
    const query = generateRandomEmbedding();
    const stats = await benchmark(
      'VectorStore.query (10000 vectors)',
      () => store.query(query, 5),
      20,
    );
    results[0].stats.push(stats);
    expect(stats.median).toBeLessThan(200);
    console.log(`  10000 vectors: ${stats.median.toFixed(3)}ms`);
  });

  it('VectorStore.add - bulk insertion', async () => {
    const store = new VectorStore();
    const items = Array.from({ length: 1000 }, (_, i) => generateRandomFunction(i));
    const stats = await benchmark(
      'VectorStore.add (1000 items)',
      () => {
        store.clear();
        for (const item of items) {
          store.add(item);
        }
      },
      50,
    );
    results.push({ groupName: 'Bulk Operations', stats: [stats] });
    expect(stats.median).toBeLessThan(50);
    console.log(`  add 1000 items: ${stats.median.toFixed(3)}ms`);
  });

  it('VectorStore snapshot + load', async () => {
    const store = new VectorStore();
    for (let i = 0; i < 1000; i++) {
      store.add(generateRandomFunction(i));
    }
    const snapshot = store.snapshot();
    const newStore = new VectorStore();
    const stats = await benchmark(
      'VectorStore snapshot + load (1000 items)',
      () => {
        newStore.load(snapshot);
      },
      100,
    );
    results[0].stats.push(stats);
    expect(stats.median).toBeLessThan(20);
    console.log(`  snapshot + load 1000: ${stats.median.toFixed(3)}ms`);
  });

  it('memory usage estimate', () => {
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
});
