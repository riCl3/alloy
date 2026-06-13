import { RateLimiter } from '../rateLimiter';

describe('RateLimiter', () => {
  it('runs tasks up to concurrency limit', async () => {
    const limiter = new RateLimiter(2);
    let running = 0;
    let maxRunning = 0;

    const task = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 50));
      running--;
    };

    await Promise.all([limiter.run(task), limiter.run(task), limiter.run(task), limiter.run(task)]);

    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it('returns task results', async () => {
    const limiter = new RateLimiter(3);
    const result = await limiter.run(async () => 42);
    expect(result).toBe(42);
  });

  it('propagates errors', async () => {
    const limiter = new RateLimiter(2);
    await expect(
      limiter.run(async () => {
        throw new Error('test error');
      }),
    ).rejects.toThrow('test error');
  });

  it('releases slot after error', async () => {
    const limiter = new RateLimiter(1);
    let completed = 0;

    const failing = async () => {
      throw new Error('fail');
    };
    const succeeding = async () => {
      completed++;
    };

    await limiter.run(failing).catch(() => {});
    await limiter.run(succeeding);

    expect(completed).toBe(1);
  });
});
