/**
 * Ollama helper — detection, model management, and download progress.
 *
 * Talks to the Ollama REST API at the configured base URL
 * (default http://localhost:11434).
 */

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

export interface OllamaStatus {
  running: boolean;
  baseUrl: string;
  installedModels: string[];
  version?: string;
}

export interface OllamaPullProgress {
  status: string;
  /** 0–100 when available, -1 when indeterminate */
  percent: number;
  totalBytes?: number;
  completedBytes?: number;
}

// ─── Detection ───────────────────────────────────────────────────

export async function getOllamaStatus(baseUrl?: string): Promise<OllamaStatus> {
  const url = baseUrl || DEFAULT_OLLAMA_URL;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    const [versionRes, tagsRes] = await Promise.all([
      fetch(`${url}/api/version`, { signal: controller.signal }).catch(() => null),
      fetch(`${url}/api/tags`, { signal: controller.signal }).catch(() => null),
    ]);
    clearTimeout(timer);

    if (!versionRes || !versionRes.ok) {
      return { running: false, baseUrl: url, installedModels: [] };
    }

    const versionData = (await versionRes.json()) as { version?: string };
    let installedModels: string[] = [];

    if (tagsRes && tagsRes.ok) {
      const tagsData = (await tagsRes.json()) as {
        models?: { name: string; size?: number }[];
      };
      installedModels = (tagsData.models ?? []).map(m => m.name);
    }

    return {
      running: true,
      baseUrl: url,
      installedModels,
      version: versionData.version,
    };
  } catch {
    return { running: false, baseUrl: url, installedModels: [] };
  }
}

// ─── Model management ────────────────────────────────────────────

/**
 * Check if a specific model is installed locally.
 * Ollama tags include size suffixes — we match the first segment.
 */
export function isModelInstalled(tag: string, installedModels: string[]): boolean {
  // Installed names can be "qwen2.5-coder:1.5b" or "qwen2.5-coder:1.5b-instruct-q5_K_M"
  // We match on the prefix before any additional qualifiers.
  return installedModels.some(installed => {
    const base = installed.split('-q')[0].split('-f16')[0];
    return base === tag || installed === tag;
  });
}

/**
 * Pull a model from the Ollama registry.
 * Returns an async generator that yields progress updates.
 */
export async function* pullModel(
  tag: string,
  baseUrl?: string,
): AsyncGenerator<OllamaPullProgress> {
  const url = baseUrl || DEFAULT_OLLAMA_URL;

  const response = await fetch(`${url}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: tag, stream: true }),
  });

  if (!response.ok) {
    throw new Error(`Ollama pull failed: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('Ollama pull returned no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as {
            status?: string;
            total?: number;
            completed?: number;
          };

          const totalBytes = parsed.total;
          const completedBytes = parsed.completed;
          const percent =
            totalBytes && totalBytes > 0 && completedBytes !== undefined
              ? Math.round((completedBytes / totalBytes) * 100)
              : -1;

          yield {
            status: parsed.status ?? 'downloading',
            percent,
            totalBytes,
            completedBytes,
          };
        } catch {
          // Skip unparseable lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Delete a locally installed model.
 */
export async function deleteModel(tag: string, baseUrl?: string): Promise<void> {
  const url = baseUrl || DEFAULT_OLLAMA_URL;
  const response = await fetch(`${url}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: tag }),
  });

  if (!response.ok) {
    throw new Error(`Ollama delete failed: ${response.status} ${response.statusText}`);
  }
}

/**
 * Generate a short completion via the Ollama API.
 * Used for quick validation after model setup.
 */
export async function generateCompletion(
  prompt: string,
  model: string,
  baseUrl?: string,
): Promise<string> {
  const url = baseUrl || DEFAULT_OLLAMA_URL;
  const response = await fetch(`${url}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0.1, num_predict: 100 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama generate failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { response?: string };
  return data.response ?? '';
}

/**
 * Format bytes to a human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
