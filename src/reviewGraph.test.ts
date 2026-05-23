import { ReviewFinding } from './types';
import { runReviewGraph, parseFindings, deduplicateFindings } from './reviewGraph';
import { callLLM } from './llmRouter';

jest.mock('./llmRouter', () => ({
  ...jest.requireActual('./llmRouter'),
  callLLM: jest.fn(),
}));

const mockCallLLM = callLLM as jest.Mock;

describe('parseFindings', () => {
  it('parses a direct JSON array', () => {
    const text = JSON.stringify([
      { line: 1, severity: 'error', message: 'Test', suggestion: 'Fix' },
    ]);
    const result = parseFindings(text);
    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(1);
  });

  it('parses JSON object with findings key', () => {
    const text = JSON.stringify({
      findings: [
        { line: 2, severity: 'warning', message: 'Issue', suggestion: 'Fix' },
      ],
    });
    const result = parseFindings(text);
    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(2);
  });

  it('returns empty array for invalid JSON', () => {
    const result = parseFindings('not json');
    expect(result).toEqual([]);
  });

  it('returns empty array for empty object without findings', () => {
    const result = parseFindings('{}');
    expect(result).toEqual([]);
  });

  it('extracts array from text containing JSON array', () => {
    const text = 'Some prefix text\n[{"line":3,"severity":"info","message":"test","suggestion":"fix"}]\nsuffix';
    const result = parseFindings(text);
    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(3);
  });
});

describe('deduplicateFindings', () => {
  it('keeps highest severity finding for same line', () => {
    const findings: ReviewFinding[] = [
      { line: 1, severity: 'info', message: 'Minor issue', suggestion: 'Fix' },
      { line: 1, severity: 'error', message: 'Critical bug', suggestion: 'Fix now' },
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('error');
    expect(result[0].message).toBe('Critical bug');
  });

  it('keeps longer message for same line and same severity', () => {
    const findings: ReviewFinding[] = [
      { line: 1, severity: 'warning', message: 'Short', suggestion: 'Fix' },
      { line: 1, severity: 'warning', message: 'Longer message with details', suggestion: 'Fix better' },
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe('Longer message with details');
  });

  it('keeps findings on different lines separate', () => {
    const findings: ReviewFinding[] = [
      { line: 1, severity: 'error', message: 'Bug A', suggestion: 'Fix' },
      { line: 5, severity: 'warning', message: 'Bug B', suggestion: 'Fix' },
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(2);
  });

  it('sorts results by line number', () => {
    const findings: ReviewFinding[] = [
      { line: 10, severity: 'info', message: 'Z', suggestion: 'Fix' },
      { line: 1, severity: 'error', message: 'A', suggestion: 'Fix' },
    ];
    const result = deduplicateFindings(findings);
    expect(result[0].line).toBe(1);
    expect(result[1].line).toBe(10);
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateFindings([])).toEqual([]);
  });
});

describe('runReviewGraph', () => {
  beforeEach(() => {
    mockCallLLM.mockReset();
  });

  it('aggregates findings from all three persona nodes', async () => {
    mockCallLLM
      .mockResolvedValueOnce({
        text: JSON.stringify({ findings: [{ line: 1, severity: 'error', message: 'SQL injection', suggestion: 'Use params' }] }),
        provider: 'groq',
        model: 'llama3',
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({ findings: [{ line: 2, severity: 'warning', message: 'Null check missing', suggestion: 'Add guard' }] }),
        provider: 'groq',
        model: 'llama3',
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({ findings: [{ line: 3, severity: 'info', message: 'Deep nesting', suggestion: 'Extract fn' }] }),
        provider: 'groq',
        model: 'llama3',
      });

    const result = await runReviewGraph({
      diff: '--- a/test.ts\n+++ b/test.ts\n@@ -0,0 +1,5 @@\n+line1\n+line2\n+line3',
      sourceCode: 'line1\nline2\nline3\nline4\nline5',
      filePath: 'test.ts',
      modifiedLines: [1, 2, 3],
      functionContext: '',
      securityFindings: [],
      logicFindings: [],
      styleFindings: [],
      finalFindings: [],
    });

    expect(result.finalFindings).toHaveLength(3);
    expect(mockCallLLM).toHaveBeenCalledTimes(3);
  });

  it('deduplicates findings on same line across personas', async () => {
    mockCallLLM
      .mockResolvedValueOnce({
        text: JSON.stringify({ findings: [{ line: 1, severity: 'error', message: 'SQL injection risk', suggestion: 'Use params' }] }),
        provider: 'groq',
        model: 'llama3',
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({ findings: [{ line: 1, severity: 'info', message: 'SQL injection on line 1', suggestion: 'Fix' }] }),
        provider: 'groq',
        model: 'llama3',
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({ findings: [] }),
        provider: 'groq',
        model: 'llama3',
      });

    const result = await runReviewGraph({
      diff: '--- a/test.ts\n+++ b/test.ts\n@@ -0,0 +1,1 @@\n+line1',
      sourceCode: 'line1\nline2\nline3',
      filePath: 'test.ts',
      modifiedLines: [1],
      functionContext: '',
      securityFindings: [],
      logicFindings: [],
      styleFindings: [],
      finalFindings: [],
    });

    expect(result.finalFindings).toHaveLength(1);
    expect(result.finalFindings[0].severity).toBe('error');
  });

  it('handles empty findings from all personas', async () => {
    mockCallLLM
      .mockResolvedValueOnce({ text: JSON.stringify({ findings: [] }), provider: 'groq', model: 'llama3' })
      .mockResolvedValueOnce({ text: JSON.stringify({ findings: [] }), provider: 'groq', model: 'llama3' })
      .mockResolvedValueOnce({ text: JSON.stringify({ findings: [] }), provider: 'groq', model: 'llama3' });

    const result = await runReviewGraph({
      diff: '--- a/test.ts\n+++ b/test.ts\n@@ -0,0 +1,1 @@\n+line1',
      sourceCode: 'line1',
      filePath: 'test.ts',
      modifiedLines: [1],
      functionContext: '',
      securityFindings: [],
      logicFindings: [],
      styleFindings: [],
      finalFindings: [],
    });

    expect(result.finalFindings).toEqual([]);
  });

  it('gracefully handles LLM failures in persona nodes', async () => {
    mockCallLLM
      .mockRejectedValueOnce(new Error('API error'))
      .mockResolvedValueOnce({ text: JSON.stringify({ findings: [{ line: 1, severity: 'error', message: 'Bug', suggestion: 'Fix' }] }), provider: 'groq', model: 'llama3' })
      .mockRejectedValueOnce(new Error('Network error'));

    const result = await runReviewGraph({
      diff: '--- a/test.ts\n+++ b/test.ts\n@@ -0,0 +1,1 @@\n+line1',
      sourceCode: 'line1',
      filePath: 'test.ts',
      modifiedLines: [1],
      functionContext: '',
      securityFindings: [],
      logicFindings: [],
      styleFindings: [],
      finalFindings: [],
    });

    expect(result.finalFindings).toHaveLength(1);
    expect(result.finalFindings[0].message).toBe('Bug');
  });
});
