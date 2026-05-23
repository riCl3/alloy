export interface IndexedFunction {
  id: string;
  filePath: string;
  functionName: string;
  signature: string;
  functionBody: string;
  embedding: number[];
}

export interface QueryResult {
  item: IndexedFunction;
  score: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export class VectorStore {
  private items: IndexedFunction[] = [];

  add(item: IndexedFunction): void {
    this.items.push(item);
  }

  clear(): void {
    this.items = [];
  }

  get size(): number {
    return this.items.length;
  }

  query(embedding: number[], k: number): QueryResult[] {
    const scored = this.items.map((item) => ({
      item,
      score: cosineSimilarity(embedding, item.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  getAll(): IndexedFunction[] {
    return [...this.items];
  }
}
