import * as vscode from 'vscode';
import { LLMProviderId } from './types';
import { providerDefaultModel } from './config';

const KEY_IDS: Record<Exclude<LLMProviderId, 'ollama'>, string> = {
  groq: 'alloy.groqApiKey',
  gemini: 'alloy.geminiApiKey',
  openaiCompatible: 'alloy.openaiCompatibleApiKey',
};

const BASE_URL_IDS: Partial<Record<LLMProviderId, string>> = {
  openaiCompatible: 'alloy.openaiCompatibleBaseUrl',
  ollama: 'alloy.ollamaBaseUrl',
};

let cachedKeys = new Map<LLMProviderId, string>();
let cachedBaseUrls = new Map<LLMProviderId, string>();

export function resetCache(): void {
  cachedKeys = new Map();
  cachedBaseUrls = new Map();
}

export function getProviderApiKey(provider: LLMProviderId): string {
  if (provider === 'ollama') return '';
  return cachedKeys.get(provider) ?? process.env[envKey(provider)] ?? '';
}

export function getProviderBaseUrl(provider: LLMProviderId): string {
  return cachedBaseUrls.get(provider) ?? process.env[baseUrlEnvKey(provider)] ?? '';
}

export function getGroqApiKey(): string {
  return getProviderApiKey('groq');
}

export function getGeminiApiKey(): string {
  return getProviderApiKey('gemini');
}

function envKey(provider: LLMProviderId): string {
  switch (provider) {
    case 'gemini':
      return 'GEMINI_API_KEY';
    case 'openaiCompatible':
      return 'OPENAI_API_KEY';
    case 'groq':
      return 'GROQ_API_KEY';
    case 'ollama':
      return '';
  }
}

function baseUrlEnvKey(provider: LLMProviderId): string {
  switch (provider) {
    case 'openaiCompatible':
      return 'OPENAI_BASE_URL';
    case 'ollama':
      return 'OLLAMA_BASE_URL';
    default:
      return '';
  }
}

async function getKeyFromStorage(secrets: vscode.SecretStorage, keyId: string): Promise<string | undefined> {
  try {
    return await secrets.get(keyId);
  } catch {
    return undefined;
  }
}

async function promptForKey(label: string, placeHolder: string): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    prompt: `Enter your ${label} API key`,
    placeHolder,
    password: true,
    ignoreFocusOut: true,
    validateInput: (input: string) => (!input || input.trim().length === 0 ? 'API key cannot be empty' : null),
  });
  return value?.trim();
}

async function promptForBaseUrl(provider: LLMProviderId): Promise<string | undefined> {
  if (provider !== 'openaiCompatible' && provider !== 'ollama') return undefined;
  const defaultUrl = provider === 'ollama' ? 'http://localhost:11434/v1' : 'https://api.openai.com/v1';
  const value = await vscode.window.showInputBox({
    prompt: provider === 'ollama' ? 'Enter your Ollama OpenAI-compatible base URL' : 'Enter your OpenAI-compatible base URL',
    placeHolder: defaultUrl,
    value: defaultUrl,
    ignoreFocusOut: true,
    validateInput: (input: string) => {
      try {
        new URL(input);
        return null;
      } catch {
        return 'Enter a valid URL';
      }
    },
  });
  return value?.trim();
}

export async function loadProviderCredentials(context: vscode.ExtensionContext, provider: LLMProviderId): Promise<{
  apiKey: string;
  baseUrl: string;
}> {
  const cachedKey = cachedKeys.get(provider);
  const cachedBaseUrl = cachedBaseUrls.get(provider);
  const apiKeyId = provider === 'ollama' ? undefined : KEY_IDS[provider];
  const baseUrlId = BASE_URL_IDS[provider];
  const storedKey = apiKeyId ? await getKeyFromStorage(context.secrets, apiKeyId) : '';
  const storedBaseUrl = baseUrlId ? await getKeyFromStorage(context.secrets, baseUrlId) : '';
  const apiKey = storedKey ?? cachedKey ?? process.env[envKey(provider)] ?? '';
  const baseUrl = storedBaseUrl ?? cachedBaseUrl ?? process.env[baseUrlEnvKey(provider)] ?? '';
  cachedKeys.set(provider, apiKey);
  cachedBaseUrls.set(provider, baseUrl);
  return { apiKey, baseUrl };
}

export async function setupProvider(context: vscode.ExtensionContext, provider: LLMProviderId): Promise<{
  provider: LLMProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
}> {
  const label = provider === 'openaiCompatible' ? 'OpenAI-compatible' : provider[0].toUpperCase() + provider.slice(1);
  let apiKey = '';
  if (provider !== 'ollama') {
    const key = await promptForKey(label, provider === 'gemini' ? 'AIza...' : provider === 'groq' ? 'gsk_...' : 'sk-...');
    apiKey = key ?? '';
    if (apiKey) await context.secrets.store(KEY_IDS[provider], apiKey);
  }

  const baseUrl = await promptForBaseUrl(provider) ?? '';
  const baseUrlId = BASE_URL_IDS[provider];
  if (baseUrl && baseUrlId) await context.secrets.store(baseUrlId, baseUrl);

  const model = await vscode.window.showInputBox({
    prompt: `Enter model for ${label}`,
    value: providerDefaultModel(provider),
    ignoreFocusOut: true,
    validateInput: (input: string) => (!input.trim() ? 'Model cannot be empty' : null),
  }) ?? providerDefaultModel(provider);

  cachedKeys.set(provider, apiKey);
  cachedBaseUrls.set(provider, baseUrl);
  return { provider, apiKey, baseUrl, model: model.trim() };
}

export async function ensureProviderReady(
  context: vscode.ExtensionContext,
  provider: LLMProviderId,
): Promise<{ apiKey: string; baseUrl: string }> {
  const credentials = await loadProviderCredentials(context, provider);
  if (provider !== 'ollama' && !credentials.apiKey) {
    throw new Error(`Alloy: ${provider} API key is missing. Run "Alloy: Setup" to configure it.`);
  }
  return credentials;
}

// Backward-compatible helper for existing tests and callers.
export async function ensureApiKeys(context: vscode.ExtensionContext): Promise<{ groq: string; gemini: string }> {
  let groq = (await loadProviderCredentials(context, 'groq')).apiKey;
  let gemini = (await loadProviderCredentials(context, 'gemini')).apiKey;
  if (!groq) {
    groq = await promptForKey('Groq', 'gsk_...') ?? '';
    if (groq) await context.secrets.store(KEY_IDS.groq, groq);
  }
  if (!gemini) {
    gemini = await promptForKey('Gemini', 'AIza...') ?? '';
    if (gemini) await context.secrets.store(KEY_IDS.gemini, gemini);
  }
  cachedKeys.set('groq', groq);
  cachedKeys.set('gemini', gemini);
  return { groq, gemini };
}
