import { callLLM, RateLimitError } from '../llmRouter';

const mockFetch = jest.fn();
global.fetch = mockFetch;

function mockOkResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (headers ?? {})[name] ?? null,
    },
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

describe('callLLM', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('calls Groq and returns response on success', async () => {
    mockFetch.mockImplementationOnce(() =>
      mockOkResponse({
        choices: [{ message: { content: '{"findings":[]}' } }],
      }),
    );

    const result = await callLLM({ prompt: 'review this', groqApiKey: 'test-key' });

    expect(result.provider).toBe('groq');
    expect(result.text).toBe('{"findings":[]}');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('api.groq.com');
  });

  it('falls back to Gemini when Groq returns 429', async () => {
    mockFetch
      .mockImplementationOnce(() =>
        mockOkResponse({ error: 'rate limited' }, 429, { 'Retry-After': '5' }),
      )
      .mockImplementationOnce(() =>
        mockOkResponse({
          candidates: [{ content: { parts: [{ text: '{"findings":[]}' }] } }],
        }),
      );

    const result = await callLLM({ prompt: 'review this', groqApiKey: 'gk', geminiApiKey: 'gem' });

    expect(result.provider).toBe('gemini');
    expect(result.text).toBe('{"findings":[]}');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws when both providers fail', async () => {
    mockFetch
      .mockImplementationOnce(() => mockOkResponse({ error: 'rate limited' }, 429))
      .mockImplementationOnce(() => mockOkResponse({ error: 'rate limited' }, 429));

    await expect(
      callLLM({ prompt: 'test', groqApiKey: 'gk', geminiApiKey: 'gem' }),
    ).rejects.toThrow('All LLM providers failed');
  });

  it('throws when Groq returns non-429 error without fallback', async () => {
    mockFetch.mockImplementationOnce(() =>
      mockOkResponse({ error: 'unauthorized' }, 401),
    );

    await expect(
      callLLM({ prompt: 'test', groqApiKey: 'bad-key' }),
    ).rejects.toThrow('Groq API error: 401');
  });

  it('falls back on network error from Groq', async () => {
    mockFetch
      .mockImplementationOnce(() => Promise.reject(new TypeError('fetch failed')))
      .mockImplementationOnce(() =>
        mockOkResponse({
          candidates: [{ content: { parts: [{ text: '{"findings":[]}' }] } }],
        }),
      );

    const result = await callLLM({ prompt: 'test', groqApiKey: 'gk', geminiApiKey: 'gem' });

    expect(result.provider).toBe('gemini');
  });

  it('passes system prompt in Groq request', async () => {
    mockFetch.mockImplementationOnce(() =>
      mockOkResponse({
        choices: [{ message: { content: '{"findings":[]}' } }],
      }),
    );

    await callLLM({
      prompt: 'review this',
      systemPrompt: 'You are a security reviewer',
      groqApiKey: 'test-key',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toBe('You are a security reviewer');
  });
});
