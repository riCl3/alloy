import { reviewDiff, ReviewDiffOptions } from './codeReviewService';
import { runReviewGraph } from './reviewGraph';

jest.mock('./reviewGraph', () => {
  const actual = jest.requireActual('./reviewGraph');
  return {
    ...actual,
    runReviewGraph: jest.fn(),
  };
});

jest.mock('./astContext', () => ({
  getFunctionContext: jest.fn().mockResolvedValue([]),
  formatFunctionContext: jest.fn().mockReturnValue(''),
}));

const mockRunReviewGraph = runReviewGraph as jest.Mock;

function makeOptions(overrides?: Partial<ReviewDiffOptions>): ReviewDiffOptions {
  return {
    diff: '--- a/file.ts\n+++ b/file.ts\n@@ -1 +1,2 @@\n-old\n+new\n+added',
    sourceCode: 'line1\nline2\nline3',
    filePath: '/repo/src/file.ts',
    modifiedLines: [2],
    uri: { fsPath: '/repo/src/file.ts' } as any,
    diagnosticCollection: { set: jest.fn() } as any,
    ...overrides,
  };
}

describe('reviewDiff', () => {
  beforeEach(() => {
    mockRunReviewGraph.mockReset();
  });

  it('clears diagnostics when diff is empty', async () => {
    const set = jest.fn();
    const options = makeOptions({ diff: '', diagnosticCollection: { set } as any });

    await reviewDiff(options);

    expect(set).toHaveBeenCalledWith(options.uri, []);
    expect(mockRunReviewGraph).not.toHaveBeenCalled();
  });

  it('clears diagnostics when diff is whitespace only', async () => {
    const set = jest.fn();
    const options = makeOptions({ diff: '   \n  \n', diagnosticCollection: { set } as any });

    await reviewDiff(options);

    expect(set).toHaveBeenCalledWith(options.uri, []);
    expect(mockRunReviewGraph).not.toHaveBeenCalled();
  });

  it('parses graph results and sets diagnostics on collection', async () => {
    mockRunReviewGraph.mockResolvedValue({
      finalFindings: [
        { line: 42, severity: 'error', message: 'SQL injection risk', suggestion: 'Use parameterized query' },
        { line: 55, severity: 'warning', message: 'Unused variable', suggestion: 'Remove it' },
      ],
    });

    const set = jest.fn();
    const options = makeOptions({ diagnosticCollection: { set } as any });
    await reviewDiff(options);

    expect(mockRunReviewGraph).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(1);

    const [calledUri, diagnostics] = set.mock.calls[0];
    expect(calledUri).toBe(options.uri);
    expect(diagnostics).toHaveLength(2);

    expect(diagnostics[0].range.start.line).toBe(41);
    expect(diagnostics[0].message).toBe('SQL injection risk');
    expect(diagnostics[0].severity).toBe(0);
    expect(diagnostics[0].source).toBe('Alloy');

    expect(diagnostics[1].range.start.line).toBe(54);
    expect(diagnostics[1].message).toBe('Unused variable');
    expect(diagnostics[1].severity).toBe(1);
    expect(diagnostics[1].source).toBe('Alloy');
  });

  it('handles empty findings array from graph', async () => {
    mockRunReviewGraph.mockResolvedValue({ finalFindings: [] });

    const set = jest.fn();
    const options = makeOptions({ diagnosticCollection: { set } as any });
    await reviewDiff(options);

    expect(set).toHaveBeenCalledWith(options.uri, []);
  });

  it('includes function context in the initial state when AST context is found', async () => {
    const mockAstContext = require('./astContext');
    (mockAstContext.getFunctionContext as jest.Mock).mockResolvedValue([
      { name: 'greet', signature: 'function greet(name: string): void', startLine: 1, endLine: 3 },
    ]);
    (mockAstContext.formatFunctionContext as jest.Mock).mockReturnValue(
      '\n\nAffected functions:\nFunction: greet\nSignature: function greet(name: string): void',
    );

    mockRunReviewGraph.mockResolvedValue({ finalFindings: [] });

    const options = makeOptions();
    await reviewDiff(options);

    expect(mockRunReviewGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        functionContext: expect.stringContaining('greet'),
      }),
    );
  });
});
