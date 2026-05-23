import { RepoStyleIndexer, getEmbedding, formatSimilarFunctions, SimilarFunctionEntry } from '../repoStyleIndexer';
import { IndexedFunction } from '../vectorStore';
import { getFunctionContext, detectLanguage } from '../astContext';

jest.mock('../astContext', () => ({
  detectLanguage: jest.fn(),
  getFunctionContext: jest.fn(),
  formatFunctionContext: jest.fn().mockReturnValue(''),
}));

const mockDetectLanguage = detectLanguage as jest.Mock;
const mockGetFunctionContext = getFunctionContext as jest.Mock;
const mockFetch = jest.fn();
global.fetch = mockFetch;

function mockEmbeddingResponse(embeddingValues: number[], status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: () => Promise.resolve({ embedding: { values: embeddingValues } }),
  } as unknown as Response);
}

describe('getEmbedding', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns embedding array on success', async () => {
    mockFetch.mockImplementationOnce(() => mockEmbeddingResponse([0.1, 0.2, 0.3]));

    const result = await getEmbedding('test code', 'fake-api-key');
    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callUrl = mockFetch.mock.calls[0][0];
    expect(callUrl).toContain('generativelanguage.googleapis.com');
  });

  it('uses custom model name', async () => {
    mockFetch.mockImplementationOnce(() => mockEmbeddingResponse([0.5]));

    await getEmbedding('code', 'key', 'custom-model');
    const callUrl = mockFetch.mock.calls[0][0];
    expect(callUrl).toContain('custom-model');
  });

  it('throws on API error', async () => {
    mockFetch.mockImplementationOnce(() => mockEmbeddingResponse([], 400));

    await expect(getEmbedding('test', 'key')).rejects.toThrow('Embedding API error: 400');
  });

  it('throws on invalid response format', async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response),
    );

    await expect(getEmbedding('test', 'key')).rejects.toThrow('Invalid embedding response format');
  });
});

describe('formatSimilarFunctions', () => {
  it('returns empty string for empty results', () => {
    expect(formatSimilarFunctions([])).toBe('');
  });

  it('formats results with similarity scores', () => {
    const items: SimilarFunctionEntry[] = [
      {
        item: {
          id: 'test.ts:foo',
          filePath: 'src/test.ts',
          functionName: 'foo',
          signature: 'function foo(x: number)',
          functionBody: 'function foo(x: number) { return x * 2; }',
          embedding: [],
        },
        score: 0.95,
      },
    ];

    const result = formatSimilarFunctions(items);
    expect(result).toContain('foo');
    expect(result).toContain('95.0%');
    expect(result).toContain('src/test.ts');
    expect(result).toContain('return x * 2');
  });

  it('formats multiple results', () => {
    const items: SimilarFunctionEntry[] = [
      {
        item: { id: 'a.ts:fn1', filePath: 'a.ts', functionName: 'fn1', signature: 'fn1()', functionBody: 'body1', embedding: [] },
        score: 0.9,
      },
      {
        item: { id: 'b.ts:fn2', filePath: 'b.ts', functionName: 'fn2', signature: 'fn2()', functionBody: 'body2', embedding: [] },
        score: 0.8,
      },
    ];

    const result = formatSimilarFunctions(items);
    expect(result).toContain('Example 1');
    expect(result).toContain('Example 2');
    expect(result).toMatch(/fn1[\s\S]*fn2/);
  });
});

describe('RepoStyleIndexer.querySimilar', () => {
  let indexer: RepoStyleIndexer;

  beforeEach(() => {
    mockFetch.mockReset();
    mockDetectLanguage.mockReset();
    mockGetFunctionContext.mockReset();

    indexer = new RepoStyleIndexer({ geminiApiKey: 'test-key' });
  });

  it('returns empty string when no functions indexed', async () => {
    mockDetectLanguage.mockReturnValue('typescript');
    mockGetFunctionContext.mockResolvedValue([
      { name: 'target', signature: 'function target()', startLine: 0, endLine: 2 },
    ]);

    const result = await indexer.querySimilar(
      'function target() {}',
      [1],
      'test.ts',
    );

    expect(result).toBe('');
  });

  it('retrieves nearest neighbors by cosine similarity', async () => {
    mockDetectLanguage.mockReturnValue('typescript');
    mockGetFunctionContext.mockResolvedValue([
      { name: 'target', signature: 'function target()', startLine: 0, endLine: 2 },
    ]);

    const vA = [1, 0, 0];

    indexer.vectorStore.add({
      id: 'exact_match',
      filePath: 'src/exact.ts',
      functionName: 'exact',
      signature: 'function exact()',
      functionBody: 'function exact() { return 1; }',
      embedding: vA,
    });
    indexer.vectorStore.add({
      id: 'near_match',
      filePath: 'src/near.ts',
      functionName: 'near',
      signature: 'function near()',
      functionBody: 'function near() { return 2; }',
      embedding: [0.9, 0.1, 0],
    });
    indexer.vectorStore.add({
      id: 'far_match',
      filePath: 'src/far.ts',
      functionName: 'far',
      signature: 'function far()',
      functionBody: 'function far() { return 3; }',
      embedding: [0, 1, 0],
    });

    // Mock embedding API to return a vector closest to vA
    mockFetch.mockImplementationOnce(() => mockEmbeddingResponse([1, 0, 0]));

    const result = await indexer.querySimilar('function target() {}', [1], 'test.ts', 2);

    expect(result).toContain('exact');
    expect(result).toContain('near');
    expect(result).not.toContain('far');
  });

  it('returns empty string if modified function has no AST context', async () => {
    mockDetectLanguage.mockReturnValue('typescript');
    mockGetFunctionContext.mockResolvedValue([]);

    const result = await indexer.querySimilar('x', [1], 'test.ts');
    expect(result).toBe('');
  });

  it('returns empty string for unsupported language', async () => {
    mockDetectLanguage.mockReturnValue(null);

    const result = await indexer.querySimilar('x', [1], 'test.py');
    expect(result).toBe('');
  });

  it('returns empty string when embedding API fails silently', async () => {
    mockDetectLanguage.mockReturnValue('typescript');
    mockGetFunctionContext.mockResolvedValue([
      { name: 'target', signature: 'function target()', startLine: 0, endLine: 2 },
    ]);
    mockFetch.mockImplementationOnce(() => Promise.reject(new TypeError('fetch failed')));

    const result = await indexer.querySimilar('function target() {}', [1], 'test.ts');
    expect(result).toBe('');
  });
});
