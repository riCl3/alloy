/**
 * Curated Ollama model profiles for Alloy code review.
 *
 * Each profile includes sizing info so the UI can show download size,
 * memory requirements, and a quality rating relative to code review.
 */

export interface OllamaModelProfile {
  /** Ollama tag (model:size) — used with `ollama pull` */
  tag: string;
  /** Human-readable name */
  name: string;
  /** One-line description of what this model is good at */
  description: string;
  /** Approximate download size in MB */
  downloadSizeMB: number;
  /** Approximate RAM required in GB */
  ramGB: number;
  /** Quality tier for code review — drives UI badge colour */
  tier: 'experimental' | 'lightweight' | 'balanced' | 'strong';
  /** Relative speed rating (1–5, 5 = fastest) */
  speed: number;
  /** Relative code quality rating (1–5, 5 = best) */
  quality: number;
}

/**
 * Ordered from smallest to largest.
 * The default recommendation is the first model in the "balanced" tier.
 */
export const OLLAMA_MODEL_PROFILES: OllamaModelProfile[] = [
  {
    tag: 'smollm2:135m',
    name: 'SmolLM2 135M',
    description: 'Ultra-lightweight. Basic completions, minimal RAM.',
    downloadSizeMB: 90,
    ramGB: 0.5,
    tier: 'experimental',
    speed: 5,
    quality: 1,
  },
  {
    tag: 'qwen2.5:0.5b',
    name: 'Qwen 2.5 0.5B',
    description: 'Best small model for code — understands structure and instructions.',
    downloadSizeMB: 400,
    ramGB: 1,
    tier: 'balanced',
    speed: 4,
    quality: 3,
  },
];

/** The recommended model tag for first-time Ollama users */
export const RECOMMENDED_MODEL_TAG = 'qwen2.5:0.5b';

/** Find a profile by Ollama tag */
export function getProfileByTag(tag: string): OllamaModelProfile | undefined {
  return OLLAMA_MODEL_PROFILES.find(p => p.tag === tag);
}

/** Get profiles grouped by tier */
export function getProfilesByTier(): Map<string, OllamaModelProfile[]> {
  const groups = new Map<string, OllamaModelProfile[]>();
  for (const profile of OLLAMA_MODEL_PROFILES) {
    const list = groups.get(profile.tier) ?? [];
    list.push(profile);
    groups.set(profile.tier, list);
  }
  return groups;
}
