import { reviewDiff, ReviewDiffOptions } from './codeReviewService';
import { sendToOllama } from './ollamaClient';

jest.mock('./ollamaClient', () => {
  const actual = jest.requireActual('./ollamaClient');
  return {
    ...actual,
    sendToOllama: jest.fn(),
  };
});

jest.mock('./astContext', () => ({
  getFunctionContext: jest.fn().mockResolvedValue([]),
  formatFunctionContext: jest.fn().mockReturnValue(''),
}));

const mockSendToOllama = sendToOllama as jest.Mock;

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
    mockSendToOllama.mockReset();
  });

  it('clears diagnostics when diff is empty', async () => {
    const set = jest.fn();
    const options = makeOptions({ diff: '', diagnosticCollection: { set } as any });

    await reviewDiff(options);

    expect(set).toHaveBeenCalledWith(options.uri, []);
    expect(mockSendToOllama).not.toHaveBeenCalled();
  });

  it('clears diagnostics when diff is whitespace only', async () => {
    const set = jest.fn();
    const options = makeOptions({ diff: '   \n  \n', diagnosticCollection: { set } as any });

    await reviewDiff(options);

    expect(set).toHaveBeenCalledWith(options.uri, []);
    expect(mockSendToOllama).not.toHaveBeenCalled();
  });

  it('parses LLM JSON response and sets diagnostics on collection', async () => {
    mockSendToOllama.mockResolvedValue(
      JSON.stringify([
        { line: 42, severity: 'error', message: 'SQL injection risk', suggestion: 'Use parameterized query' },
        { line: 55, severity: 'warning', message: 'Unused variable', suggestion: 'Remove it' },
      ]),
    );

    const set = jest.fn();
    const options = makeOptions({ diagnosticCollection: { set } as any });
    await reviewDiff(options);

    expect(mockSendToOllama).toHaveBeenCalledTimes(1);
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

  it('handles empty findings array from LLM', async () => {
    mockSendToOllama.mockResolvedValue('[]');

    const set = jest.fn();
    const options = makeOptions({ diagnosticCollection: { set } as any });
    await reviewDiff(options);

    expect(set).toHaveBeenCalledWith(options.uri, []);
  });

  it('throws when LLM returns invalid JSON', async () => {
    mockSendToOllama.mockResolvedValue('not valid json');

    const options = makeOptions();
    await expect(reviewDiff(options)).rejects.toThrow('Failed to parse LLM response');
  });

  it('throws when LLM returns non-array JSON', async () => {
    mockSendToOllama.mockResolvedValue('{"not": "an array"}');

    const options = makeOptions();
    await expect(reviewDiff(options)).rejects.toThrow('Failed to parse LLM response');
  });

  it('includes diff content in the prompt sent to Ollama', async () => {
    mockSendToOllama.mockResolvedValue('[]');

    const options = makeOptions({ diff: 'test-diff-content' });
    await reviewDiff(options);

    expect(mockSendToOllama).toHaveBeenCalledWith(
      expect.stringContaining('test-diff-content'),
      undefined,
    );
  });

  it('passes ollama options when provided', async () => {
    mockSendToOllama.mockResolvedValue('[]');

    const ollamaOpts = { model: 'llama3', host: 'http://localhost:11434' };
    const options = makeOptions({ ollamaOptions: ollamaOpts });
    await reviewDiff(options);

    expect(mockSendToOllama).toHaveBeenCalledWith(
      expect.any(String),
      ollamaOpts,
    );
  });

  it('includes function context in the prompt when AST context is found', async () => {
    const mockAstContext = require('./astContext');
    (mockAstContext.getFunctionContext as jest.Mock).mockResolvedValue([
      { name: 'greet', signature: 'function greet(name: string): void', startLine: 1, endLine: 3 },
    ]);
    (mockAstContext.formatFunctionContext as jest.Mock).mockReturnValue(
      '\n\nAffected functions:\nFunction: greet\nSignature: function greet(name: string): void',
    );

    mockSendToOllama.mockResolvedValue('[]');

    const options = makeOptions();
    await reviewDiff(options);

    expect(mockSendToOllama).toHaveBeenCalledWith(
      expect.stringContaining('greet'),
      undefined,
    );
  });
});
