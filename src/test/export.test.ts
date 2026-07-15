import { exportFindingsJSON, exportFindingsMarkdown } from '../export';
import { ReviewFinding } from '../types';

describe('exportFindingsJSON', () => {
  it('returns empty object for empty map', () => {
    const result = exportFindingsJSON(new Map());
    expect(result).toBe('{}');
  });

  it('exports findings grouped by URI key', () => {
    const findings: ReviewFinding[] = [
      { line: 10, severity: 'error', message: 'SQL injection', suggestion: 'Use parameterized query', category: 'security' },
    ];
    const map = new Map<string, ReviewFinding[]>();
    map.set('file:///project/src/app.ts', findings);

    const result = JSON.parse(exportFindingsJSON(map));

    expect(result['file:///project/src/app.ts']).toHaveLength(1);
    expect(result['file:///project/src/app.ts'][0].message).toBe('SQL injection');
  });

  it('exports multiple files with findings', () => {
    const map = new Map<string, ReviewFinding[]>();
    map.set('file:///a.ts', [
      { line: 1, severity: 'warning', message: 'Unused import', suggestion: 'Remove' },
    ]);
    map.set('file:///b.ts', [
      { line: 5, severity: 'info', message: 'Style nit', suggestion: 'Fix' },
    ]);

    const result = JSON.parse(exportFindingsJSON(map));

    expect(Object.keys(result)).toHaveLength(2);
    expect(result['file:///a.ts']).toHaveLength(1);
    expect(result['file:///b.ts']).toHaveLength(1);
  });

  it('preserves all finding fields in JSON output', () => {
    const finding: ReviewFinding = {
      line: 42,
      severity: 'error',
      message: 'Test message',
      suggestion: 'Test suggestion',
      category: 'security',
      confidence: 'high',
      rationale: 'Because it matters',
      replacement: 'safeCode()',
      range: { startLine: 42, startCharacter: 0, endLine: 42, endCharacter: 10 },
    };
    const map = new Map<string, ReviewFinding[]>();
    map.set('file:///test.ts', [finding]);

    const result = JSON.parse(exportFindingsJSON(map));
    const exported = result['file:///test.ts'][0];

    expect(exported.line).toBe(42);
    expect(exported.severity).toBe('error');
    expect(exported.message).toBe('Test message');
    expect(exported.suggestion).toBe('Test suggestion');
    expect(exported.category).toBe('security');
    expect(exported.confidence).toBe('high');
    expect(exported.rationale).toBe('Because it matters');
    expect(exported.replacement).toBe('safeCode()');
    expect(exported.range).toEqual({ startLine: 42, startCharacter: 0, endLine: 42, endCharacter: 10 });
  });

  it('handles findings without optional fields', () => {
    const finding: ReviewFinding = {
      line: 1,
      severity: 'warning',
      message: 'Warning',
      suggestion: '',
    };
    const map = new Map<string, ReviewFinding[]>();
    map.set('file:///test.ts', [finding]);

    const result = JSON.parse(exportFindingsJSON(map));
    const exported = result['file:///test.ts'][0];

    expect(exported.category).toBeUndefined();
    expect(exported.confidence).toBeUndefined();
    expect(exported.rationale).toBeUndefined();
    expect(exported.replacement).toBeUndefined();
    expect(exported.range).toBeUndefined();
  });
});

describe('exportFindingsMarkdown', () => {
  it('returns report with no issues for empty map', () => {
    const result = exportFindingsMarkdown(new Map());
    expect(result).toContain('No issues found');
    expect(result).toContain('Alloy Code Review Report');
    expect(result).toContain('## Summary');
  });

  it('includes summary table with error/warning/info counts', () => {
    const map = new Map<string, ReviewFinding[]>();
    map.set('file:///test.ts', [
      { line: 1, severity: 'error', message: 'Error A', suggestion: 'Fix A' },
      { line: 2, severity: 'warning', message: 'Warning A', suggestion: 'Fix B' },
      { line: 3, severity: 'info', message: 'Info A', suggestion: 'Fix C' },
    ]);

    const result = exportFindingsMarkdown(map);

    expect(result).toContain('| Errors | 1 |');
    expect(result).toContain('| Warnings | 1 |');
    expect(result).toContain('| Info | 1 |');
    expect(result).toContain('| **Total** | **3** |');
  });

  it('groups findings by file', () => {
    const map = new Map<string, ReviewFinding[]>();
    map.set('file:///project/src/a.ts', [
      { line: 5, severity: 'error', message: 'Error in A', suggestion: 'Fix A' },
    ]);
    map.set('file:///project/src/b.ts', [
      { line: 10, severity: 'warning', message: 'Warning in B', suggestion: 'Fix B' },
    ]);

    const result = exportFindingsMarkdown(map);

    expect(result).toContain('### a.ts');
    expect(result).toContain('### b.ts');
    expect(result).toContain('Error in A');
    expect(result).toContain('Warning in B');
  });

  it('renders finding table with line, severity, category, message, suggestion', () => {
    const map = new Map<string, ReviewFinding[]>();
    map.set('file:///test.ts', [
      { line: 42, severity: 'error', message: 'Test msg', suggestion: 'Test sug', category: 'security' },
    ]);

    const result = exportFindingsMarkdown(map);

    expect(result).toContain('| 42 | error | security | Test msg | Test sug |');
  });

  it('uses "general" for findings without category', () => {
    const map = new Map<string, ReviewFinding[]>();
    map.set('file:///test.ts', [
      { line: 1, severity: 'warning', message: 'No category', suggestion: '' },
    ]);

    const result = exportFindingsMarkdown(map);

    expect(result).toContain('general');
  });

  it('escapes pipe characters in message and suggestion', () => {
    const map = new Map<string, ReviewFinding[]>();
    map.set('file:///test.ts', [
      { line: 1, severity: 'error', message: 'Pipe | in message', suggestion: 'Fix | it' },
    ]);

    const result = exportFindingsMarkdown(map);

    expect(result).toContain('Pipe \\| in message');
    expect(result).toContain('Fix \\| it');
  });

  it('includes generation timestamp', () => {
    const result = exportFindingsMarkdown(new Map());
    expect(result).toMatch(/\*\*Generated:\*\* \d{4}-\d{2}-\d{2}T/);
  });

  it('handles multiple findings in same file', () => {
    const map = new Map<string, ReviewFinding[]>();
    map.set('file:///test.ts', [
      { line: 1, severity: 'error', message: 'First', suggestion: 'Fix 1' },
      { line: 5, severity: 'warning', message: 'Second', suggestion: 'Fix 2' },
      { line: 10, severity: 'info', message: 'Third', suggestion: 'Fix 3' },
    ]);

    const result = exportFindingsMarkdown(map);

    expect(result).toContain('| 1 | error |');
    expect(result).toContain('| 5 | warning |');
    expect(result).toContain('| 10 | info |');
  });
});
