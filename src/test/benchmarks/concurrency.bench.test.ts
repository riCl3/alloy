import { RateLimiter } from '../../rateLimiter';
import { formatStats, BenchmarkResult } from './helpers/benchmarkRunner';

function createSlowTask(ms: number): () => Promise<number> {
  return () => new Promise((resolve) => setTimeout(() => resolve(Date.now()), ms));
}

function createFastTask(): () => Promise<number> {
  return () => Promise.resolve(Date.now());
}

describe('Concurrency Benchmarks', () => {
  const results: BenchmarkResult[] = [];

  afterAll(() => {
    const lines: string[] = [];
    lines.push('');
    lines.push('='.repeat(60));
    lines.push('  CONCURRENCY BENCHMARKS');
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

  it('RateLimiter throughput - 1 concurrent', async () => {
    const limiter = new RateLimiter(1);
    const tasks = Array.from({ length: 10 }, () => createFastTask());

    const start = performance.now();
    await Promise.all(tasks.map((t) => limiter.run(t)));
    const elapsed = performance.now() - start;

    console.log(`  1 concurrent, 10 tasks: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeGreaterThan(0);
  });

  it('RateLimiter throughput - 3 concurrent', async () => {
    const limiter = new RateLimiter(3);
    const tasks = Array.from({ length: 10 }, () => createFastTask());

    const start = performance.now();
    await Promise.all(tasks.map((t) => limiter.run(t)));
    const elapsed = performance.now() - start;

    console.log(`  3 concurrent, 10 tasks: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeGreaterThan(0);
  });

  it('RateLimiter throughput - 5 concurrent', async () => {
    const limiter = new RateLimiter(5);
    const tasks = Array.from({ length: 10 }, () => createFastTask());

    const start = performance.now();
    await Promise.all(tasks.map((t) => limiter.run(t)));
    const elapsed = performance.now() - start;

    console.log(`  5 concurrent, 10 tasks: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeGreaterThan(0);
  });

  it('concurrency speedup measurement', async () => {
    const taskCount = 20;
    const taskDuration = 10;

    const results1 = await measureConcurrency(1, taskCount, taskDuration);
    const results3 = await measureConcurrency(3, taskCount, taskDuration);
    const results5 = await measureConcurrency(5, taskCount, taskDuration);

    const speedup3 = results1.elapsed / results3.elapsed;
    const speedup5 = results1.elapsed / results5.elapsed;

    results.push({
      groupName: 'Concurrency Speedup',
      stats: [
        {
          name: '1 concurrent (baseline)',
          iterations: 1,
          median: results1.elapsed,
          p95: results1.elapsed,
          p99: results1.elapsed,
          min: results1.elapsed,
          max: results1.elapsed,
          mean: results1.elapsed,
        },
        {
          name: '3 concurrent',
          iterations: 1,
          median: results3.elapsed,
          p95: results3.elapsed,
          p99: results3.elapsed,
          min: results3.elapsed,
          max: results3.elapsed,
          mean: results3.elapsed,
          opsPerSec: speedup3,
        },
        {
          name: '5 concurrent',
          iterations: 1,
          median: results5.elapsed,
          p95: results5.elapsed,
          p99: results5.elapsed,
          min: results5.elapsed,
          max: results5.elapsed,
          mean: results5.elapsed,
          opsPerSec: speedup5,
        },
      ],
    });

    console.log(`  1 concurrent: ${results1.elapsed.toFixed(2)}ms`);
    console.log(`  3 concurrent: ${results3.elapsed.toFixed(2)}ms (${speedup3.toFixed(1)}x speedup)`);
    console.log(`  5 concurrent: ${results5.elapsed.toFixed(2)}ms (${speedup5.toFixed(1)}x speedup)`);

    expect(speedup3).toBeGreaterThan(1);
    expect(speedup5).toBeGreaterThan(speedup3);
  });

  it('RateLimiter error handling', async () => {
    const limiter = new RateLimiter(2);
    let errors = 0;

    const tasks = Array.from({ length: 10 }, (_, i) =>
      limiter.run(async () => {
        if (i % 3 === 0) throw new Error('task error');
        return i;
      }).catch(() => { errors++; }),
    );

    await Promise.all(tasks);
    console.log(`  10 tasks, ${errors} errors handled correctly`);
    expect(errors).toBe(4);
  });

  it('queue wait time under load', async () => {
    const limiter = new RateLimiter(1);
    const waitTimes: number[] = [];

    const slowTask = createSlowTask(5);
    const tasks = Array.from({ length: 5 }, async () => {
      const start = performance.now();
      await limiter.run(slowTask);
      waitTimes.push(performance.now() - start);
    });

    await Promise.all(tasks);

    const avgWait = waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length;
    console.log(`  Queue wait times: ${waitTimes.map((w) => w.toFixed(1)).join(', ')}ms`);
    console.log(`  Average wait: ${avgWait.toFixed(1)}ms`);
    expect(waitTimes.length).toBe(5);
  });
});

async function measureConcurrency(
  concurrent: number,
  taskCount: number,
  taskDurationMs: number,
): Promise<{ elapsed: number }> {
  const limiter = new RateLimiter(concurrent);
  const start = performance.now();
  const tasks = Array.from({ length: taskCount }, () =>
    limiter.run(createSlowTask(taskDurationMs)),
  );
  await Promise.all(tasks);
  return { elapsed: performance.now() - start };
}
