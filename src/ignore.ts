import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_SKIP_PATTERNS = [
  'node_modules/**',
  'dist/**',
  'build/**',
  'out/**',
  'coverage/**',
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '*.min.js',
  '*.map',
];

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function escapeRegex(text: string): string {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

function globToRegex(glob: string): RegExp {
  const normalized = normalizePath(glob).replace(/^\/+/, '');
  let pattern = '';
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === '*' && next === '*') {
      pattern += '.*';
      i++;
    } else if (char === '*') {
      pattern += '[^/]*';
    } else if (char === '?') {
      pattern += '[^/]';
    } else {
      pattern += escapeRegex(char);
    }
  }
  return new RegExp(`(^|/)${pattern}$`);
}

// Caches for .alloyignore patterns and compiled globs
interface IgnoreCache {
  mtime: number;
  patterns: string[];
}

const ignoreCache = new Map<string, IgnoreCache>();
const compiledGlobCache = new Map<string, RegExp>();

function getCompiledGlob(glob: string): RegExp {
  let regex = compiledGlobCache.get(glob);
  if (!regex) {
    regex = globToRegex(glob);
    compiledGlobCache.set(glob, regex);
  }
  return regex;
}

export function loadAlloyIgnore(workspacePath: string): string[] {
  const ignorePath = path.join(workspacePath, '.alloyignore');
  const cached = ignoreCache.get(workspacePath);
  try {
    const stat = fs.statSync(ignorePath);
    if (cached && cached.mtime === stat.mtimeMs) {
      return cached.patterns;
    }
    const raw = fs.readFileSync(ignorePath, 'utf-8');
    const patterns = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    ignoreCache.set(workspacePath, { mtime: stat.mtimeMs, patterns });
    return patterns;
  } catch {
    if (cached) return cached.patterns;
    ignoreCache.set(workspacePath, { mtime: 0, patterns: [] });
    return [];
  }
}

export function clearIgnoreCache(): void {
  ignoreCache.clear();
  compiledGlobCache.clear();
}

export function shouldSkipPath(filePath: string, workspacePath: string, configuredPatterns: string[] = []): boolean {
  const relative = normalizePath(path.relative(workspacePath, filePath));
  const configured = Array.isArray(configuredPatterns) ? configuredPatterns : [];
  const patterns = [...DEFAULT_SKIP_PATTERNS, ...configured, ...loadAlloyIgnore(workspacePath)];
  return patterns.some((pattern) => getCompiledGlob(pattern).test(relative));
}

export const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs',
  '.py', '.pyi',
  '.go',
  '.rs',
  '.java',
  '.cs',
  '.php',
  '.rb',
  '.vue', '.svelte',
  '.kt', '.kts',
  '.swift',
  '.c', '.cpp', '.h', '.hpp',
]);

export function isSupportedSourceFile(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath));
}
