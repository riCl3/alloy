import { deduplicateFindings } from '../../reviewGraph';
import { ReviewFinding } from '../../types';
import { benchmark, formatStats, BenchmarkResult } from './helpers/benchmarkRunner';
import { createMixedFindings, createFindingsAcrossLines } from './helpers/mockLlm';

describe('Deduplication Benchmarks', () => {
  const results: BenchmarkResult[] = [];

  afterAll(() => {
    const lines: string[] = [];
    lines.push('');
    lines.push('='.repeat(60));
    lines.push('  DEDUPLICATION BENCHMARKS');
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

  it('deduplicateFindings - 10 findings', async () => {
    const findings = createMixedFindings(10);
    const stats = await benchmark(
      'deduplicateFindings (10 findings)',
      () => deduplicateFindings(findings),
      1000,
    );
    results.push({ groupName: 'Dedup Speed', stats: [stats] });
    expect(stats.median).toBeLessThan(1);
    console.log(`  10 findings: ${stats.median.toFixed(3)}ms`);
  });

  it('deduplicateFindings - 50 findings', async () => {
    const findings = createMixedFindings(50);
    const stats = await benchmark(
      'deduplicateFindings (50 findings)',
      () => deduplicateFindings(findings),
      500,
    );
    results[0].stats.push(stats);
    expect(stats.median).toBeLessThan(5);
    console.log(`  50 findings: ${stats.median.toFixed(3)}ms`);
  });

  it('deduplicateFindings - 100 findings', async () => {
    const findings = createMixedFindings(100);
    const stats = await benchmark(
      'deduplicateFindings (100 findings)',
      () => deduplicateFindings(findings),
      200,
    );
    results[0].stats.push(stats);
    expect(stats.median).toBeLessThan(10);
    console.log(`  100 findings: ${stats.median.toFixed(3)}ms`);
  });

  it('deduplicateFindings - 500 findings', async () => {
    const findings = createMixedFindings(500);
    const stats = await benchmark(
      'deduplicateFindings (500 findings)',
      () => deduplicateFindings(findings),
      50,
    );
    results[0].stats.push(stats);
    expect(stats.median).toBeLessThan(50);
    console.log(`  500 findings: ${stats.median.toFixed(3)}ms`);
  });

  it('dedup reduction ratio - same line conflicts', () => {
    const lines = Array.from({ length: 50 }, (_, i) => i + 1);
    const findings = createFindingsAcrossLines(lines, 5, 'security');
    const before = findings.length;
    const after = deduplicateFindings(findings);
    const reduction = ((before - after.length) / before) * 100;
    console.log(`  Reduction: ${before} -> ${after.length} (${reduction.toFixed(1)}% reduction)`);
    expect(reduction).toBeGreaterThan(50);
  });

  it('dedup reduction ratio - mixed categories', () => {
    const findings = createMixedFindings(200);
    const before = findings.length;
    const after = deduplicateFindings(findings);
    const reduction = ((before - after.length) / before) * 100;
    console.log(`  Mixed reduction: ${before} -> ${after.length} (${reduction.toFixed(1)}% reduction)`);
    expect(reduction).toBeGreaterThan(30);
  });

  it('dedup preserves highest severity', () => {
    const findings: ReviewFinding[] = [
      { line: 10, severity: 'info', message: 'Info finding', suggestion: 'Info suggestion', category: 'logic' },
      { line: 10, severity: 'warning', message: 'Warning finding', suggestion: 'Warning suggestion', category: 'logic' },
      { line: 10, severity: 'error', message: 'Error finding', suggestion: 'Error suggestion', category: 'logic' },
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('error');
    console.log('  Preserved highest severity: error (correct)');
  });

  it('dedup preserves longest message for same severity', () => {
    const findings: ReviewFinding[] = [
      { line: 10, severity: 'warning', message: 'Short', suggestion: 'Short', category: 'logic' },
      { line: 10, severity: 'warning', message: 'This is a much longer and more detailed message about the issue', suggestion: 'Long suggestion', category: 'logic' },
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0].message.length).toBeGreaterThan(10);
    console.log(`  Preserved longer message: ${result[0].message.length} chars`);
  });
});
