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

export interface StoreSnapshot {
  items: IndexedFunction[];
  fileMtimes: Record<string, number>;
}

export class VectorStore {
  private items: IndexedFunction[] = [];
  private fileMtimes = new Map<string, number>();

  add(item: IndexedFunction): void {
    this.items.push(item);
  }

  clear(): void {
    this.items = [];
    this.fileMtimes.clear();
  }

  get size(): number {
    return this.items.length;
  }

  setFileMtime(filePath: string, mtime: number): void {
    this.fileMtimes.set(filePath, mtime);
  }

  getFileMtime(filePath: string): number | undefined {
    return this.fileMtimes.get(filePath);
  }

  hasFileChanged(filePath: string, currentMtime: number): boolean {
    const cached = this.fileMtimes.get(filePath);
    return cached === undefined || cached !== currentMtime;
  }

  removeFile(filePath: string): void {
    this.fileMtimes.delete(filePath);
    const toRemove = new Set(this.items.filter((i) => i.filePath === filePath).map((i) => i.id));
    this.items = this.items.filter((i) => !toRemove.has(i.id));
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

  snapshot(): StoreSnapshot {
    const mtimes: Record<string, number> = {};
    for (const [path, mtime] of this.fileMtimes) {
      mtimes[path] = mtime;
    }
    return { items: [...this.items], fileMtimes: mtimes };
  }

  load(data: StoreSnapshot): void {
    this.items = [...data.items];
    this.fileMtimes.clear();
    for (const [path, mtime] of Object.entries(data.fileMtimes)) {
      this.fileMtimes.set(path, mtime);
    }
  }
}
