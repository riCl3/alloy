import { VectorStore, IndexedFunction, cosineSimilarity } from '../vectorStore';

function makeItem(id: string, embedding: number[]): IndexedFunction {
  return {
    id,
    filePath: `src/${id}.ts`,
    functionName: id,
    signature: `function ${id}()`,
    functionBody: `function ${id}() {}`,
    embedding,
  };
}

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthonormal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it('returns correct value for same-direction vectors', () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1, 5);
  });

  it('returns correct value for partial overlap', () => {
    const sim = cosineSimilarity([1, 0, 0], [0.9, 0.1, 0]);
    expect(sim).toBeGreaterThan(0.9);
    expect(sim).toBeLessThan(1);
  });

  it('returns 0 for zero vector', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBeCloseTo(0, 5);
  });

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBeCloseTo(0, 5);
  });
});

describe('VectorStore', () => {
  let store: VectorStore;

  beforeEach(() => {
    store = new VectorStore();
  });

  it('starts empty', () => {
    expect(store.size).toBe(0);
    expect(store.query([1, 0, 0], 3)).toEqual([]);
  });

  it('adds items', () => {
    store.add(makeItem('foo', [1, 0, 0]));
    expect(store.size).toBe(1);
  });

  it('query returns items sorted by similarity descending', () => {
    const v1 = [1, 0, 0];
    const v2 = [0, 1, 0];
    const v3 = [0.9, 0.1, 0];

    store.add(makeItem('orthogonal', v2));
    store.add(makeItem('exact', v1));
    store.add(makeItem('close', v3));

    const results = store.query([1, 0, 0], 3);

    expect(results).toHaveLength(3);
    expect(results[0].item.id).toBe('exact');
    expect(results[0].score).toBeCloseTo(1, 3);
    expect(results[1].item.id).toBe('close');
    expect(results[1].score).toBeGreaterThan(0.9);
    expect(results[2].item.id).toBe('orthogonal');
    expect(results[2].score).toBeCloseTo(0, 3);
  });

  it('query respects k limit', () => {
    store.add(makeItem('a', [1, 0]));
    store.add(makeItem('b', [1, 0.1]));
    store.add(makeItem('c', [1, 0.2]));

    expect(store.query([1, 0], 2)).toHaveLength(2);
    expect(store.query([1, 0], 1)).toHaveLength(1);
  });

  it('clear removes all items', () => {
    store.add(makeItem('a', [1, 0]));
    store.clear();
    expect(store.size).toBe(0);
  });

  it('getAll returns a copy of all items', () => {
    store.add(makeItem('a', [1, 0]));
    const all = store.getAll();
    expect(all).toHaveLength(1);
    // mutating returned copy doesn't affect store
    all.pop();
    expect(store.size).toBe(1);
  });
});
