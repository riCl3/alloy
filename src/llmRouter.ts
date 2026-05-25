import { LLMProviderId, LLMResponse } from './types';
import { getProviderApiKey, getProviderBaseUrl } from './secretManager';
import { getAlloyConfig } from './config';

export interface RouterOptions {
  prompt: string;
  systemPrompt?: string;
  provider?: LLMProviderId;
  apiKey?: string;
  groqApiKey?: string;
  geminiApiKey?: string;
  openaiApiKey?: string;
  model?: string;
  groqModel?: string;
  geminiModel?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  responseSchema?: Record<string, unknown>;
  structuredOutput?: boolean;
}

export class RateLimitError extends Error {
  constructor(message: string, public readonly retryAfter?: number) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export interface LLMProvider {
  id: LLMProviderId;
  review(options: RouterOptions): Promise<LLMResponse>;
  validateCredentials(options?: Partial<RouterOptions>): Promise<void>;
  embed?(text: string): Promise<number[]>;
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof RateLimitError) return true;
  if (err instanceof TypeError && err.message.includes('fetch')) return true;
  if (err instanceof Error && /(API error|Provider error): (4\d\d|5\d\d)/.test(err.message)) return true;
  return false;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function messages(options: RouterOptions): { role: string; content: string }[] {
  const result: { role: string; content: string }[] = [];
  if (options.systemPrompt) result.push({ role: 'system', content: options.systemPrompt });
  result.push({ role: 'user', content: options.prompt });
  return result;
}

function groqKey(options: RouterOptions): string {
  return options.apiKey ?? options.groqApiKey ?? getProviderApiKey('groq');
}

function geminiKey(options: RouterOptions): string {
  return options.apiKey ?? options.geminiApiKey ?? getProviderApiKey('gemini');
}

function openAiKey(options: RouterOptions): string {
  return options.apiKey ?? options.openaiApiKey ?? getProviderApiKey('openaiCompatible');
}

function configuredBaseUrl(provider: 'openaiCompatible' | 'ollama', explicit?: string): string {
  const stored = getProviderBaseUrl(provider);
  const fallback = provider === 'ollama' ? 'http://localhost:11434/v1' : 'https://api.openai.com/v1';
  return explicit || stored || fallback;
}

async function callOpenAICompatible(
  provider: LLMProviderId,
  url: string,
  apiKey: string,
  model: string,
  options: RouterOptions,
): Promise<LLMResponse> {
  if (!apiKey && provider !== 'ollama') throw new Error(`${provider} API key is missing`);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const body: Record<string, unknown> = {
    model,
    messages: messages(options),
    temperature: options.temperature ?? 0.1,
    max_tokens: options.maxTokens ?? 1024,
  };
  if (options.structuredOutput !== false && options.responseSchema) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const label = provider === 'groq' ? 'Groq' : provider === 'openaiCompatible' ? 'OpenAI-compatible' : provider === 'ollama' ? 'Ollama' : provider;
  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') ?? '30', 10);
    throw new RateLimitError(`${label} API rate limited`, retryAfter);
  }
  if (!response.ok) throw new Error(`${label} API error: ${response.status} ${response.statusText}`);

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  return { text: data.choices?.[0]?.message?.content ?? '', provider, model };
}

class GroqProvider implements LLMProvider {
  id: LLMProviderId = 'groq';

  review(options: RouterOptions): Promise<LLMResponse> {
    const model = options.model ?? options.groqModel ?? 'llama-3.3-70b-versatile';
    return callOpenAICompatible(
      'groq',
      'https://api.groq.com/openai/v1/chat/completions',
      groqKey(options),
      model,
      options,
    );
  }

  async validateCredentials(options?: Partial<RouterOptions>): Promise<void> {
    await this.review({ prompt: 'Reply with OK.', apiKey: options?.apiKey, model: options?.model, maxTokens: 20, structuredOutput: false });
  }
}

class OpenAICompatibleProvider implements LLMProvider {
  id: LLMProviderId = 'openaiCompatible';

  review(options: RouterOptions): Promise<LLMResponse> {
    const model = options.model ?? 'gpt-4o-mini';
    const baseUrl = configuredBaseUrl('openaiCompatible', options.baseUrl);
    return callOpenAICompatible(
      'openaiCompatible',
      `${baseUrl.replace(/\/$/, '')}/chat/completions`,
      openAiKey(options),
      model,
      options,
    );
  }

  async validateCredentials(options?: Partial<RouterOptions>): Promise<void> {
    await this.review({
      prompt: 'Reply with OK.',
      apiKey: options?.apiKey,
      baseUrl: options?.baseUrl,
      model: options?.model,
      maxTokens: 20,
      structuredOutput: false,
    });
  }
}

class OllamaProvider implements LLMProvider {
  id: LLMProviderId = 'ollama';

  review(options: RouterOptions): Promise<LLMResponse> {
    const model = options.model ?? 'llama3.1';
    const baseUrl = configuredBaseUrl('ollama', options.baseUrl);
    return callOpenAICompatible('ollama', `${baseUrl.replace(/\/$/, '')}/chat/completions`, '', model, options);
  }

  async validateCredentials(options?: Partial<RouterOptions>): Promise<void> {
    await this.review({
      prompt: 'Reply with OK.',
      baseUrl: options?.baseUrl,
      model: options?.model,
      maxTokens: 20,
      structuredOutput: false,
    });
  }
}

class GeminiProvider implements LLMProvider {
  id: LLMProviderId = 'gemini';

  async review(options: RouterOptions): Promise<LLMResponse> {
    const apiKey = geminiKey(options);
    if (!apiKey) throw new Error('Gemini API key is missing');
    const model = normalizeGeminiModel(options.model ?? options.geminiModel ?? 'gemini-1.5-flash');
    const contents: { parts: { text: string }[] }[] = [];
    if (options.systemPrompt) contents.push({ parts: [{ text: options.systemPrompt }] });
    contents.push({ parts: [{ text: options.prompt }] });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: options.temperature ?? 0.1,
          maxOutputTokens: options.maxTokens ?? 1400,
          ...(options.structuredOutput !== false && options.responseSchema ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    });

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') ?? '30', 10);
      throw new RateLimitError('Gemini API rate limited', retryAfter);
    }
    if (!response.ok) throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);

    const data = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return { text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '', provider: 'gemini', model };
  }

  async validateCredentials(options?: Partial<RouterOptions>): Promise<void> {
    await this.review({ prompt: 'Reply with OK.', apiKey: options?.apiKey, model: options?.model, maxTokens: 20, structuredOutput: false });
  }
}

function normalizeGeminiModel(model: string): string {
  return model.trim().replace(/^models\//, '');
}

const providers: Record<LLMProviderId, LLMProvider> = {
  groq: new GroqProvider(),
  gemini: new GeminiProvider(),
  openaiCompatible: new OpenAICompatibleProvider(),
  ollama: new OllamaProvider(),
};

export function getLLMProvider(provider: LLMProviderId): LLMProvider {
  return providers[provider];
}

export async function validateProvider(provider: LLMProviderId, options?: Partial<RouterOptions>): Promise<void> {
  await getLLMProvider(provider).validateCredentials(options);
}

export async function callLLM(options: RouterOptions): Promise<LLMResponse> {
  if (options.provider) {
    const result = await getLLMProvider(options.provider).review(options);
    console.log(`[Alloy] LLM call succeeded via ${result.provider} (${result.model})`);
    return result;
  }

  const config = getAlloyConfig();
  try {
    const result = await getLLMProvider(config.provider).review({
      ...options,
      provider: config.provider,
      model: options.model ?? config.model,
    });
    console.log(`[Alloy] LLM call succeeded via ${result.provider} (${result.model})`);
    return result;
  } catch (primaryErr) {
    console.warn(`[Alloy] ${config.provider} failed: ${(primaryErr as Error).message}`);
    const geminiFallbackKey = options.geminiApiKey || getProviderApiKey('gemini');
    if (config.provider !== 'groq' || !isRetryableError(primaryErr) || !geminiFallbackKey) {
      throw primaryErr;
    }
    try {
      const result = await getLLMProvider('gemini').review({ ...options, provider: 'gemini', apiKey: geminiFallbackKey });
      console.log(`[Alloy] LLM call succeeded via Gemini (${result.model})`);
      return result;
    } catch (fallbackErr) {
      throw new Error(
        `All LLM providers failed. ${config.provider}: ${(primaryErr as Error).message}. Gemini: ${(fallbackErr as Error).message}`,
      );
    }
  }
}
