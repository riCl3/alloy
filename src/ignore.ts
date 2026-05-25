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

export function loadAlloyIgnore(workspacePath: string): string[] {
  const ignorePath = path.join(workspacePath, '.alloyignore');
  try {
    const raw = fs.readFileSync(ignorePath, 'utf-8');
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  } catch {
    return [];
  }
}

export function shouldSkipPath(filePath: string, workspacePath: string, configuredPatterns: string[] = []): boolean {
  const relative = normalizePath(path.relative(workspacePath, filePath));
  const configured = Array.isArray(configuredPatterns) ? configuredPatterns : [];
  const patterns = [...DEFAULT_SKIP_PATTERNS, ...configured, ...loadAlloyIgnore(workspacePath)];
  return patterns.some((pattern) => globToRegex(pattern).test(relative));
}

export function isSupportedSourceFile(filePath: string): boolean {
  return ['.ts', '.tsx', '.js', '.mjs', '.cjs'].includes(path.extname(filePath));
}
