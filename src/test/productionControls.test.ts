import { shouldSkipPath } from '../ignore';
import { redactSensitiveText } from '../redaction';
import { buildReviewCacheKey, clearReviewCache, getCachedReview, setCachedReview } from '../reviewCache';

describe('production controls', () => {
  it('skips generated and configured paths', () => {
    expect(shouldSkipPath('/repo/node_modules/pkg/index.ts', '/repo')).toBe(true);
    expect(shouldSkipPath('/repo/src/generated/client.ts', '/repo', ['src/generated/**'])).toBe(true);
    expect(shouldSkipPath('/repo/src/app.ts', '/repo', ['src/generated/**'])).toBe(false);
  });

  it('redacts common provider keys and env-style secrets', () => {
    const result = redactSensitiveText('GROQ_API_KEY=gsk_abcdefghijklmnopqrstuvwxyz token=keep');
    expect(result).toContain('GROQ_API_KEY=[REDACTED]');
    expect(result).not.toContain('gsk_abcdefghijklmnopqrstuvwxyz');
  });

  it('caches reviews by exact key', () => {
    clearReviewCache();
    const key = buildReviewCacheKey('/repo/a.ts', 'diff', 'model', 'fast');
    setCachedReview('/repo/a.ts', key, [
      { line: 1, severity: 'warning', message: 'Issue', suggestion: 'Fix' },
    ]);

    expect(getCachedReview('/repo/a.ts', key)).toHaveLength(1);
    expect(getCachedReview('/repo/a.ts', `${key}-miss`)).toBeUndefined();
  });
});
