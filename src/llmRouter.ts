import { LLMResponse } from './types';
import { getGroqApiKey, getGeminiApiKey } from './secretManager';

export interface RouterOptions {
  prompt: string;
  systemPrompt?: string;
  groqApiKey?: string;
  geminiApiKey?: string;
  groqModel?: string;
  geminiModel?: string;
}

export class RateLimitError extends Error {
  constructor(message: string, public readonly retryAfter?: number) {
    super(message);
    this.name = 'RateLimitError';
  }
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof RateLimitError) return true;
  if (err instanceof TypeError && err.message.includes('fetch')) return true;
  if (err instanceof Error && /Groq API error: (4\d\d|5\d\d)/.test(err.message)) return true;
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

async function callGroq(options: RouterOptions): Promise<LLMResponse> {
  const apiKey = options.groqApiKey ?? getGroqApiKey();
  if (!apiKey) {
    throw new Error('Groq API key is missing');
  }
  const model = options.groqModel ?? 'llama-3.3-70b-versatile';

  const messages: { role: string; content: string }[] = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: options.prompt });

  console.log(`[Alloy] Calling Groq API (model: ${model})...`);
  const response = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: 'json_object' },
    }),
  });

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') ?? '30', 10);
    throw new RateLimitError('Groq API rate limited', retryAfter);
  }

  if (!response.ok) {
    throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    choices: { message: { content: string } }[];
  };
  return {
    text: data.choices[0].message.content,
    provider: 'groq',
    model,
  };
}

async function callGemini(options: RouterOptions): Promise<LLMResponse> {
  const apiKey = options.geminiApiKey ?? getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is missing');
  }
  const model = options.geminiModel ?? 'gemini-1.5-flash';

  const contents: { parts: { text: string }[] }[] = [];
  if (options.systemPrompt) {
    contents.push({ parts: [{ text: options.systemPrompt }] });
  }
  contents.push({ parts: [{ text: options.prompt }] });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  console.log(`[Alloy] Calling Gemini API (model: ${model})...`);
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents }),
  });

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') ?? '30', 10);
    throw new RateLimitError('Gemini API rate limited', retryAfter);
  }

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return { text, provider: 'gemini', model };
}

export async function callLLM(options: RouterOptions): Promise<LLMResponse> {
  try {
    const result = await callGroq(options);
    console.log(`[Alloy] LLM call succeeded via Groq (${result.model})`);
    return result;
  } catch (groqErr) {
    console.warn(`[Alloy] Groq failed: ${(groqErr as Error).message}`);
    if (isRetryableError(groqErr)) {
      try {
        const result = await callGemini(options);
        console.log(`[Alloy] LLM call succeeded via Gemini (${result.model})`);
        return result;
      } catch (geminiErr) {
        console.error(`[Alloy] Gemini also failed: ${(geminiErr as Error).message}`);
        throw new Error(
          `All LLM providers failed. Groq: ${(groqErr as Error).message}. Gemini: ${(geminiErr as Error).message}`,
        );
      }
    }
    throw groqErr;
  }
}
