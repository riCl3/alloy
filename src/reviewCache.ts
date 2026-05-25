import { createHash } from 'crypto';
import { ReviewFinding } from './types';

interface CacheEntry {
  key: string;
  findings: ReviewFinding[];
}

const cache = new Map<string, CacheEntry>();

export function buildReviewCacheKey(filePath: string, diff: string, model: string, reviewMode: string): string {
  return createHash('sha256')
    .update(filePath)
    .update('\0')
    .update(diff)
    .update('\0')
    .update(model)
    .update('\0')
    .update(reviewMode)
    .digest('hex');
}

export function getCachedReview(filePath: string, key: string): ReviewFinding[] | undefined {
  const entry = cache.get(filePath);
  return entry?.key === key ? entry.findings.map((finding) => ({ ...finding })) : undefined;
}

export function setCachedReview(filePath: string, key: string, findings: ReviewFinding[]): void {
  cache.set(filePath, {
    key,
    findings: findings.map((finding) => ({ ...finding })),
  });
}

export function clearReviewCache(filePath?: string): void {
  if (filePath) {
    cache.delete(filePath);
  } else {
    cache.clear();
  }
}
