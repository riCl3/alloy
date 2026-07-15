import { getAlloyConfig, providerDefaultModel } from '../config';
import { workspace } from 'vscode';

jest.mock('vscode');

describe('config', () => {
  let mockGet: jest.Mock;

  beforeEach(() => {
    mockGet = jest.fn();
    (workspace.getConfiguration as unknown as jest.Mock).mockReturnValue({
      get: mockGet,
      update: jest.fn(),
    });
  });

  it('returns default config values', () => {
    mockGet.mockImplementation((_key: string, defaultValue?: unknown) => defaultValue);

    const config = getAlloyConfig();
    expect(config.provider).toBe('groq');
    expect(config.model).toBe('llama-3.3-70b-versatile');
    expect(config.reviewMode).toBe('fast');
    expect(config.maxDiffLines).toBe(600);
    expect(config.maxFilesPerReview).toBe(12);
    expect(config.debounceMs).toBe(2000);
    expect(config.enabledCategories).toEqual(['security', 'logic', 'quality', 'performance', 'test']);
    expect(config.enabledSeverities).toEqual(['error', 'warning', 'info']);
  });

  it('coerces invalid provider to groq', () => {
    mockGet.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'provider') return 'invalid';
      return defaultValue;
    });

    const config = getAlloyConfig();
    expect(config.provider).toBe('groq');
  });

  it('accepts valid providers', () => {
    mockGet.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'provider') return 'gemini';
      return defaultValue;
    });

    const config = getAlloyConfig();
    expect(config.provider).toBe('gemini');
  });

  it('coerces invalid review mode to fast', () => {
    mockGet.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'reviewMode') return 'invalid';
      return defaultValue;
    });

    const config = getAlloyConfig();
    expect(config.reviewMode).toBe('fast');
  });

  it('accepts valid review modes', () => {
    mockGet.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'reviewMode') return 'deep';
      return defaultValue;
    });

    const config = getAlloyConfig();
    expect(config.reviewMode).toBe('deep');
  });

  it('uses configured model over default', () => {
    mockGet.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'model') return 'custom-model';
      return defaultValue;
    });

    const config = getAlloyConfig();
    expect(config.model).toBe('custom-model');
  });

  it('enforces minimum debounce', () => {
    mockGet.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'debounceMs') return 100;
      return defaultValue;
    });

    const config = getAlloyConfig();
    expect(config.debounceMs).toBe(250);
  });

  it('filters invalid categories', () => {
    mockGet.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'enabledCategories') return ['security', 'invalid'];
      return defaultValue;
    });

    const config = getAlloyConfig();
    expect(config.enabledCategories).toEqual(['security']);
  });

  it('returns default categories for empty array', () => {
    mockGet.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'enabledCategories') return [];
      return defaultValue;
    });

    const config = getAlloyConfig();
    expect(config.enabledCategories).toEqual(['security', 'logic', 'quality', 'performance', 'test']);
  });

  it('returns provider default models', () => {
    expect(providerDefaultModel('groq')).toBe('llama-3.3-70b-versatile');
    expect(providerDefaultModel('gemini')).toBe('gemini-1.5-flash');
    expect(providerDefaultModel('openaiCompatible')).toBe('gpt-4o-mini');
    expect(providerDefaultModel('ollama')).toBe('llama3.1');
  });
});
