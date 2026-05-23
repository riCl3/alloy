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
  return false;
}

async function callGroq(options: RouterOptions): Promise<LLMResponse> {
  const apiKey = options.groqApiKey ?? getGroqApiKey();
  const model = options.groqModel ?? 'llama-3.1-70b-versatile';

  const messages: { role: string; content: string }[] = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: options.prompt });

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
  const model = options.geminiModel ?? 'gemini-1.5-flash';

  const contents: { parts: { text: string }[] }[] = [];
  if (options.systemPrompt) {
    contents.push({ parts: [{ text: options.systemPrompt }] });
  }
  contents.push({ parts: [{ text: options.prompt }] });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents }),
  });

  if (response.status === 429) {
    throw new RateLimitError('Gemini API rate limited');
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
    return await callGroq(options);
  } catch (groqErr) {
    if (isRetryableError(groqErr)) {
      try {
        return await callGemini(options);
      } catch (geminiErr) {
        throw new Error(
          `All LLM providers failed. Groq: ${(groqErr as Error).message}. Gemini: ${(geminiErr as Error).message}`,
        );
      }
    }
    throw groqErr;
  }
}
