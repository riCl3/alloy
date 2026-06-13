import { buildReviewCacheKey, getCachedReview, setCachedReview, clearReviewCache } from '../reviewCache';

describe('reviewCache', () => {
  beforeEach(() => {
    clearReviewCache();
  });

  it('returns undefined for cache miss', () => {
    expect(getCachedReview('file.ts', 'key')).toBeUndefined();
  });

  it('returns findings for cache hit', () => {
    const findings = [{ line: 1, severity: 'warning' as const, message: 'test', suggestion: 'fix' }];
    setCachedReview('file.ts', 'key1', findings);

    const cached = getCachedReview('file.ts', 'key1');
    expect(cached).toHaveLength(1);
    expect(cached![0].message).toBe('test');
  });

  it('returns undefined for wrong key', () => {
    setCachedReview('file.ts', 'key1', [{ line: 1, severity: 'warning' as const, message: 'test', suggestion: 'fix' }]);
    expect(getCachedReview('file.ts', 'wrong-key')).toBeUndefined();
  });

  it('clears specific file', () => {
    setCachedReview('file1.ts', 'k1', [{ line: 1, severity: 'warning' as const, message: 'a', suggestion: 'fix' }]);
    setCachedReview('file2.ts', 'k2', [{ line: 1, severity: 'warning' as const, message: 'b', suggestion: 'fix' }]);
    clearReviewCache('file1.ts');

    expect(getCachedReview('file1.ts', 'k1')).toBeUndefined();
    expect(getCachedReview('file2.ts', 'k2')).toHaveLength(1);
  });

  it('clears all files', () => {
    setCachedReview('file1.ts', 'k1', [{ line: 1, severity: 'warning' as const, message: 'a', suggestion: 'fix' }]);
    setCachedReview('file2.ts', 'k2', [{ line: 1, severity: 'warning' as const, message: 'b', suggestion: 'fix' }]);
    clearReviewCache();

    expect(getCachedReview('file1.ts', 'k1')).toBeUndefined();
    expect(getCachedReview('file2.ts', 'k2')).toBeUndefined();
  });

  it('evicts oldest entry when max size reached', () => {
    for (let i = 0; i < 200; i++) {
      setCachedReview(`file${i}.ts`, `key${i}`, [{ line: 1, severity: 'warning' as const, message: `${i}`, suggestion: 'fix' }]);
    }

    // Cache is full at 200 entries
    expect(getCachedReview('file0.ts', 'key0')).toHaveLength(1);

    // Adding one more should evict the oldest
    setCachedReview('file200.ts', 'key200', [{ line: 1, severity: 'warning' as const, message: '200', suggestion: 'fix' }]);

    expect(getCachedReview('file0.ts', 'key0')).toBeUndefined();
    expect(getCachedReview('file200.ts', 'key200')).toHaveLength(1);
  });

  it('builds deterministic cache key', () => {
    const key1 = buildReviewCacheKey('file.ts', 'diff', 'model', 'fast');
    const key2 = buildReviewCacheKey('file.ts', 'diff', 'model', 'fast');
    expect(key1).toBe(key2);
  });

  it('builds different keys for different inputs', () => {
    const key1 = buildReviewCacheKey('file.ts', 'diff', 'model', 'fast');
    const key2 = buildReviewCacheKey('file.ts', 'diff', 'model', 'deep');
    expect(key1).not.toBe(key2);
  });
});
