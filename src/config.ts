import * as vscode from 'vscode';
import { AlloyRuntimeConfig, FindingCategory, LLMProviderId, ReviewMode, Severity } from './types';

const DEFAULT_CATEGORIES: FindingCategory[] = ['security', 'logic', 'quality', 'performance', 'test'];
const DEFAULT_SEVERITIES: Severity[] = ['error', 'warning', 'info'];

const DEFAULT_MODELS: Record<LLMProviderId, string> = {
  groq: 'llama-3.3-70b-versatile',
  gemini: 'gemini-1.5-flash',
  openaiCompatible: 'gpt-4o-mini',
  ollama: 'llama3.1',
};

function coerceProvider(value: unknown): LLMProviderId {
  return value === 'gemini' || value === 'openaiCompatible' || value === 'ollama' || value === 'groq'
    ? value
    : 'groq';
}

function coerceReviewMode(value: unknown): ReviewMode {
  return value === 'deep' || value === 'architecture' || value === 'fast' ? value : 'fast';
}

function coerceCategories(value: unknown): FindingCategory[] {
  if (!Array.isArray(value)) return DEFAULT_CATEGORIES;
  const allowed = new Set(DEFAULT_CATEGORIES);
  const result = value.filter((item): item is FindingCategory => allowed.has(item));
  return result.length > 0 ? result : DEFAULT_CATEGORIES;
}

function coerceSeverities(value: unknown): Severity[] {
  if (!Array.isArray(value)) return DEFAULT_SEVERITIES;
  const allowed = new Set(DEFAULT_SEVERITIES);
  const result = value.filter((item): item is Severity => allowed.has(item));
  return result.length > 0 ? result : DEFAULT_SEVERITIES;
}

export function getAlloyConfig(): AlloyRuntimeConfig {
  const config = vscode.workspace.getConfiguration('alloy');
  const provider = coerceProvider(config.get('provider', 'groq'));
  const configuredModel = config.get('model', '');
  const maxDiffLines = config.get('maxDiffLines', 600);
  const maxFilesPerReview = config.get('maxFilesPerReview', 12);
  const skipPaths = config.get<unknown>('skipPaths', []);
  const debounceMs = config.get('debounceMs', 2000);
  return {
    provider,
    model: typeof configuredModel === 'string' && configuredModel
      ? configuredModel
      : DEFAULT_MODELS[provider],
    reviewMode: coerceReviewMode(config.get('reviewMode', 'fast')),
    maxDiffLines: Math.max(1, typeof maxDiffLines === 'number' ? maxDiffLines : 600),
    maxFilesPerReview: Math.max(1, typeof maxFilesPerReview === 'number' ? maxFilesPerReview : 12),
    skipPaths: Array.isArray(skipPaths) ? skipPaths.filter((item): item is string => typeof item === 'string') : [],
    enabledCategories: coerceCategories(config.get('enabledCategories', DEFAULT_CATEGORIES)),
    enabledSeverities: coerceSeverities(config.get('enabledSeverities', DEFAULT_SEVERITIES)),
    debounceMs: Math.max(250, typeof debounceMs === 'number' ? debounceMs : 2000),
  };
}

export function providerDefaultModel(provider: LLMProviderId): string {
  return DEFAULT_MODELS[provider];
}
