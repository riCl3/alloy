const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(gsk_[A-Za-z0-9_-]{20,})\b/g,
  /\b(AIza[0-9A-Za-z_-]{20,})\b/g,
  /\b(sk-[A-Za-z0-9_-]{20,})\b/g,
  /\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
  /\b(xox[baprs]-[A-Za-z0-9-]{20,})\b/g,
  /\b([A-Za-z0-9_]*TOKEN[A-Za-z0-9_]*\s*=\s*)[^\s'"`]+/gi,
  /\b([A-Za-z0-9_]*SECRET[A-Za-z0-9_]*\s*=\s*)[^\s'"`]+/gi,
  /\b([A-Za-z0-9_]*API[_-]?KEY[A-Za-z0-9_]*\s*=\s*)[^\s'"`]+/gi,
];

const LARGE_LITERAL = /(["'`])([A-Za-z0-9+/=_-]{120,})\1/g;

export function redactSensitiveText(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match, prefix?: string) => {
      if (typeof prefix === 'string' && match.startsWith(prefix)) {
        return `${prefix}[REDACTED]`;
      }
      return '[REDACTED_SECRET]';
    });
  }
  return redacted.replace(LARGE_LITERAL, '$1[REDACTED_LARGE_LITERAL]$1');
}
