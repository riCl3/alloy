export interface OllamaOptions {
  model?: string;
  host?: string;
}

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
}

export async function sendToOllama(
  prompt: string,
  options?: OllamaOptions,
): Promise<string> {
  const host = options?.host ?? 'http://localhost:11434';
  const model = options?.model ?? 'codellama';

  const response = await fetch(`${host}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: 'json',
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Ollama API returned ${response.status}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as OllamaGenerateResponse;
  return data.response;
}

export function buildReviewPrompt(diff: string, functionContext?: string): string {
  const parts: string[] = [
    'You are an AI code reviewer. Review the following git diff and identify potential issues.',
    '',
    'Return your findings as a JSON array of objects with these exact fields:',
    '- "line": <integer line number (1-based) in the new file>',
    '- "severity": <"error" | "warning" | "info">',
    '- "message": <string description of the issue>',
    '- "suggestion": <string suggested fix>',
    '',
    'Rules:',
    '- Only review changed lines (added or modified).',
    '- Focus on real issues: bugs, security, performance, error handling.',
    '- Do not comment on formatting or style.',
    '- Return an empty array [] if no issues found.',
    '- Respond ONLY with the JSON array, no other text.',
  ];

  if (functionContext) {
    parts.push('', functionContext);
  }

  parts.push('', 'Diff:', diff);

  return parts.join('\n');
}
