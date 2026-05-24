import { VectorStore, IndexedFunction, type StoreSnapshot } from './vectorStore';
import { detectLanguage, getFunctionContext } from './astContext';
import * as fs from 'fs';
import * as path from 'path';

export interface IndexerOptions {
  geminiApiKey?: string;
  embeddingModel?: string;
}

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);

function walkDirectory(dir: string, maxDepth = 10, depth = 0): string[] {
  if (depth > maxDepth) return [];
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkDirectory(fullPath, maxDepth, depth + 1));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // skip unreadable directories
  }
  return results;
}

async function extractAllFunctions(filePath: string, sourceCode: string): Promise<IndexedFunction[]> {
  const lang = detectLanguage(filePath);
  if (!lang) return [];

  const idBase = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
  const lines = sourceCode.split('\n');
  const allLineNumbers = lines.map((_, i) => i);

  const ctx = await getFunctionContext(sourceCode, allLineNumbers, filePath);

  const seen = new Set<string>();
  const results: IndexedFunction[] = [];
  for (const f of ctx) {
    const body = lines.slice(f.startLine, f.endLine + 1).join('\n');
    const key = `${f.name}:${body}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      id: `${idBase}:${f.name}`,
      filePath: idBase,
      functionName: f.name,
      signature: f.signature,
      functionBody: body,
      embedding: [],
    });
  }

  return results;
}

export async function getEmbedding(text: string, apiKey: string, model?: string): Promise<number[]> {
  const embedModel = model ?? 'text-embedding-004';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${embedModel}:embedContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${embedModel}`,
      content: { parts: [{ text }] },
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    embedding?: { values?: number[] };
  };

  const values = data.embedding?.values;
  if (!values || !Array.isArray(values)) {
    throw new Error('Invalid embedding response format');
  }

  return values;
}

export interface SimilarFunctionEntry {
  item: IndexedFunction;
  score: number;
}

export function formatSimilarFunctions(results: SimilarFunctionEntry[]): string {
  if (results.length === 0) return '';
  const parts = results.map(
    (r, i) =>
      `[Example ${i + 1}] (similarity: ${(r.score * 100).toFixed(1)}%)\n` +
      `File: ${r.item.filePath}\n` +
      `Function: ${r.item.functionName}\n` +
      `Signature: ${r.item.signature}\n` +
      `Code:\n${r.item.functionBody}`,
  );
  return `\n\nSimilar functions from the codebase (for style reference):\n${parts.join('\n\n')}`;
}

const CACHE_FILENAME = 'alloy-index.json';

export class RepoStyleIndexer {
  private store = new VectorStore();
  private apiKey: string;
  private embeddingModel: string;
  private cacheDir: string | null = null;

  constructor(options?: IndexerOptions) {
    this.apiKey = options?.geminiApiKey ?? process.env.GEMINI_API_KEY ?? '';
    this.embeddingModel = options?.embeddingModel ?? 'text-embedding-004';
  }

  get vectorStore(): VectorStore {
    return this.store;
  }

  private cachePath(): string | null {
    return this.cacheDir ? path.join(this.cacheDir, CACHE_FILENAME) : null;
  }

  private loadFromCache(): boolean {
    const filePath = this.cachePath();
    if (!filePath) return false;
    try {
      if (!fs.existsSync(filePath)) return false;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as StoreSnapshot;
      this.store.load(data);
      console.log(`[Alloy Indexer] Loaded ${this.store.size} indexed functions from cache`);
      return true;
    } catch (err) {
      console.warn(`[Alloy Indexer] Failed to load cache: ${(err as Error).message}`);
      return false;
    }
  }

  private saveToCache(): void {
    const filePath = this.cachePath();
    if (!filePath) return;
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = this.store.snapshot();
      fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
      console.log(`[Alloy Indexer] Saved ${this.store.size} indexed functions to cache`);
    } catch (err) {
      console.warn(`[Alloy Indexer] Failed to save cache: ${(err as Error).message}`);
    }
  }

  async initialize(workspacePath: string, cacheDir?: string): Promise<void> {
    this.cacheDir = cacheDir ?? null;

    const loaded = this.loadFromCache();

    const files = walkDirectory(workspacePath);
    const filesToIndex: string[] = [];

    for (const filePath of files) {
      try {
        const stat = fs.statSync(filePath);
        const mtime = stat.mtimeMs;
        if (loaded && !this.store.hasFileChanged(filePath, mtime)) {
          continue;
        }
        filesToIndex.push(filePath);
        this.store.setFileMtime(filePath, mtime);
      } catch {
        filesToIndex.push(filePath);
      }
    }

    if (filesToIndex.length === 0) {
      console.log(`[Alloy Indexer] All files are up to date (${this.store.size} functions cached)`);
      return;
    }

    console.log(`[Alloy Indexer] Indexing ${filesToIndex.length} new/changed files...`);
    const allFunctions: IndexedFunction[] = [];

    for (const filePath of filesToIndex) {
      try {
        // Remove stale entries for this file before re-indexing
        this.store.removeFile(filePath);
        const sourceCode = fs.readFileSync(filePath, 'utf-8');
        const functions = await extractAllFunctions(filePath, sourceCode);
        allFunctions.push(...functions);
      } catch {
        // skip unreadable files
      }
    }

    const batchSize = 10;
    for (let i = 0; i < allFunctions.length; i += batchSize) {
      const batch = allFunctions.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((fn) =>
          getEmbedding(fn.signature + '\n' + fn.functionBody, this.apiKey, this.embeddingModel).then(
            (embedding) => {
              fn.embedding = embedding;
              this.store.add(fn);
            },
          ),
        ),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        console.warn(`[Alloy Indexer] ${failed} embeddings failed in batch ${Math.floor(i / batchSize) + 1}`);
      }
    }

    this.saveToCache();
  }

  async querySimilar(sourceCode: string, modifiedLines: number[], filePath: string, k = 3): Promise<string> {
    const lang = detectLanguage(filePath);
    if (!lang || this.store.size === 0) return '';

    const ctx = await getFunctionContext(sourceCode, modifiedLines, filePath);
    if (ctx.length === 0) return '';

    const targetFn = ctx[0];
    const lines = sourceCode.split('\n');
    const body = lines.slice(targetFn.startLine, targetFn.endLine + 1).join('\n');
    const embedText = `${targetFn.signature}\n${body}`;

    let embedding: number[];
    try {
      embedding = await getEmbedding(embedText, this.apiKey, this.embeddingModel);
    } catch {
      return '';
    }

    const results = this.store.query(embedding, k);
    return formatSimilarFunctions(results);
  }
}
