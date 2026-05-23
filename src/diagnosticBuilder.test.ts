import { buildDiagnostics } from './diagnosticBuilder';
import { ReviewFinding } from './types';

describe('buildDiagnostics', () => {
  it('converts a single error finding with correct 0-based line number', () => {
    const findings: ReviewFinding[] = [
      { line: 42, severity: 'error', message: 'SQL injection risk', suggestion: 'Use parameterized query' },
    ];

    const result = buildDiagnostics(findings);

    expect(result).toHaveLength(1);
    expect(result[0].range.start.line).toBe(41);
    expect(result[0].range.start.character).toBe(0);
    expect(result[0].range.end.line).toBe(41);
    expect(result[0].message).toBe('SQL injection risk');
    expect(result[0].severity).toBe(0);
    expect(result[0].source).toBe('Alloy');
  });

  it('converts a warning finding to Warning severity', () => {
    const findings: ReviewFinding[] = [
      { line: 10, severity: 'warning', message: 'Unused variable', suggestion: 'Remove it' },
    ];

    const result = buildDiagnostics(findings);

    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe(1);
  });

  it('converts an info finding to Information severity', () => {
    const findings: ReviewFinding[] = [
      { line: 5, severity: 'info', message: 'Consider adding a type hint', suggestion: 'Add str type' },
    ];

    const result = buildDiagnostics(findings);

    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe(2);
  });

  it('handles line number 1 correctly (maps to index 0)', () => {
    const findings: ReviewFinding[] = [
      { line: 1, severity: 'error', message: 'Issue on first line', suggestion: 'Fix' },
    ];

    const result = buildDiagnostics(findings);

    expect(result[0].range.start.line).toBe(0);
  });

  it('handles multiple findings on different lines', () => {
    const findings: ReviewFinding[] = [
      { line: 5, severity: 'error', message: 'Bug A', suggestion: 'Fix A' },
      { line: 12, severity: 'warning', message: 'Smell B', suggestion: 'Fix B' },
      { line: 20, severity: 'info', message: 'Nit C', suggestion: 'Fix C' },
    ];

    const result = buildDiagnostics(findings);

    expect(result).toHaveLength(3);
    expect(result[0].range.start.line).toBe(4);
    expect(result[1].range.start.line).toBe(11);
    expect(result[2].range.start.line).toBe(19);
    expect(result[0].severity).toBe(0);
    expect(result[1].severity).toBe(1);
    expect(result[2].severity).toBe(2);
  });

  it('returns empty array for empty findings', () => {
    const result = buildDiagnostics([]);
    expect(result).toEqual([]);
  });

  it('clamps negative line numbers to 0', () => {
    const findings: ReviewFinding[] = [
      { line: 0, severity: 'error', message: 'Bad line', suggestion: 'Fix' },
    ];

    const result = buildDiagnostics(findings);

    expect(result[0].range.start.line).toBe(0);
  });

  it('sets source to Alloy on every diagnostic', () => {
    const findings: ReviewFinding[] = [
      { line: 1, severity: 'error', message: 'A', suggestion: '' },
      { line: 2, severity: 'warning', message: 'B', suggestion: '' },
    ];

    const result = buildDiagnostics(findings);

    expect(result[0].source).toBe('Alloy');
    expect(result[1].source).toBe('Alloy');
  });
});
