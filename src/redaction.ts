const SECRET_PATTERNS: RegExp[] = [
  // Private keys (RSA, EC, DSA, OPENSSH, etc.)
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // Groq API keys: gsk_...
  /\b(gsk_[A-Za-z0-9_-]{20,})\b/g,
  // Gemini API keys: AIza...
  /\b(AIza[0-9A-Za-z_-]{20,})\b/g,
  // OpenAI API keys: sk-... / sk-proj-...
  /\b(sk-[A-Za-z0-9_-]{20,})\b/g,
  /\b(sk-proj-[A-Za-z0-9_-]{30,})\b/g,
  // GitHub classic tokens: ghp_, gho_, ghu_, ghs_, ghr_
  /\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
  // GitHub fine-grained tokens: github_pat_...
  /\b(github_pat_[A-Za-z0-9_-]{30,})\b/g,
  // Slack tokens: xoxb-, xoxa-, xoxp-, xoxr-, xoxs-
  /\b(xox[baprs]-[A-Za-z0-9-]{20,})\b/g,
  // GitLab tokens: glpat-...
  /\b(glpat-[A-Za-z0-9_-]{20,})\b/g,
  // AWS access keys: AKIA... (access key ID) + ASIA... (temporary session)
  /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/g,
  // JWT tokens (three base64url segments separated by dots, 20+ chars each)
  /\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g,
  // Generic password/key assignments (keeps the key name)
  /\b([A-Za-z0-9_]*PASSWORD[A-Za-z0-9_]*\s*=\s*)[^\s'"`]+/gi,
  /\b([A-Za-z0-9_]*TOKEN[A-Za-z0-9_]*\s*=\s*)[^\s'"`]+/gi,
  /\b([A-Za-z0-9_]*SECRET[A-Za-z0-9_]*\s*=\s*)[^\s'"`]+/gi,
  /\b([A-Za-z0-9_]*API[_-]?KEY[A-Za-z0-9_]*\s*=\s*)[^\s'"`]+/gi,
];

const LARGE_LITERAL = /(["'`])([A-Za-z0-9+/=_-]{120,})\1/g;

export function redactSensitiveText(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match, prefix?: string) => {
      if (typeof prefix === 'string' && match.length > prefix.length) {
        // Variable-assignment patterns like "MY_TOKEN = secretVal" — keep the key name
        return `${prefix}[REDACTED]`;
      }
      return '[REDACTED_SECRET]';
    });
  }
  return redacted.replace(LARGE_LITERAL, '$1[REDACTED_LARGE_LITERAL]$1');
}
