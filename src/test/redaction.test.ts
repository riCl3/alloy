import { redactSensitiveText } from '../redaction';

describe('redaction', () => {
  it('redacts Groq API keys', () => {
    const text = 'Using key gsk_abcdefghijklmnopqrstuvwx';
    const result = redactSensitiveText(text);
    // Patterns that capture the entire key replace with [REDACTED_SECRET]
    expect(result).toContain('[REDACTED_SECRET]');
    expect(result).not.toContain('gsk_');
  });

  it('redacts Gemini API keys', () => {
    const text = 'Key: AIzaSyAabcdefghijklmnopqrstuv';
    const result = redactSensitiveText(text);
    expect(result).toContain('[REDACTED_SECRET]');
    expect(result).not.toContain('AIza');
  });

  it('redacts OpenAI API keys', () => {
    const text = 'sk-abcdefghijklmnopqrstuvwxyz123456';
    const result = redactSensitiveText(text);
    expect(result).toContain('[REDACTED_SECRET]');
    expect(result).not.toContain('sk-');
  });

  it('redacts OpenAI project-level API keys (sk-proj-)', () => {
    const text = 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuv';
    const result = redactSensitiveText(text);
    expect(result).toContain('[REDACTED_SECRET]');
    expect(result).not.toContain('sk-proj-');
  });

  it('redacts GitHub classic tokens', () => {
    const text = 'ghp_abcdefghijklmnopqrstuvwxyz';
    const result = redactSensitiveText(text);
    expect(result).toContain('[REDACTED_SECRET]');
    expect(result).not.toContain('ghp_');
  });

  it('redacts GitHub fine-grained tokens (github_pat_)', () => {
    const text = 'github_pat_abcdefghijklmnopqrstuvwxyz1234567890!';
    const result = redactSensitiveText(text);
    expect(result).toContain('[REDACTED_SECRET]');
    expect(result).not.toContain('github_pat_');
  });

  it('redacts GitLab tokens (glpat-)', () => {
    const text = 'glpat-abcdefghijklmnopqrstuvwxyz';
    const result = redactSensitiveText(text);
    expect(result).toContain('[REDACTED_SECRET]');
    expect(result).not.toContain('glpat-');
  });

  it('redacts Slack bot tokens (xoxb-)', () => {
    const text = 'xoxb-FAKEFAKE-ABCD-12345678901234567890';
    const result = redactSensitiveText(text);
    expect(result).toContain('[REDACTED_SECRET]');
    expect(result).not.toContain('xoxb-');
  });

  it('redacts AWS access keys (AKIA)', () => {
    const text = 'AKIAIOSFODNN7EXAMPLE';
    const result = redactSensitiveText(text);
    expect(result).toContain('[REDACTED_SECRET]');
    expect(result).not.toContain('AKIA');
  });

  it('redacts AWS temporary keys (ASIA)', () => {
    const text = 'ASIAIOSFODNN7EXAMPLE';
    const result = redactSensitiveText(text);
    expect(result).toContain('[REDACTED_SECRET]');
    expect(result).not.toContain('ASIA');
  });

  it('redacts JWT tokens', () => {
    const text = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3j6K5o6l7sGfQ';
    const result = redactSensitiveText(text);
    expect(result).toContain('[REDACTED_SECRET]');
    expect(result).not.toContain('eyJhbG');
  });

  it('redacts PASSWORD assignments', () => {
    const text = 'DB_PASSWORD = supersecure123';
    const result = redactSensitiveText(text);
    expect(result).toContain('DB_PASSWORD');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('supersecure123');
  });

  it('redacts TOKEN assignments', () => {
    const text = 'MY_TOKEN = secretvalue123';
    const result = redactSensitiveText(text);
    expect(result).toContain('MY_TOKEN');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('secretvalue123');
  });

  it('redacts SECRET assignments', () => {
    const text = 'API_SECRET = supersecretvalue';
    const result = redactSensitiveText(text);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('supersecretvalue');
  });

  it('redacts API_KEY assignments', () => {
    const text = 'MY_API_KEY = keyvalue123';
    const result = redactSensitiveText(text);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('keyvalue123');
  });

  it('redacts private keys', () => {
    const text = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----';
    const result = redactSensitiveText(text);
    // Private keys use [REDACTED_SECRET] not [REDACTED]
    expect(result).toContain('REDACTED');
    expect(result).not.toContain('MIIEvgIBADANBg');
  });

  it('redacts large base64 literals', () => {
    const text = `"${'A'.repeat(120)}"`;
    expect(redactSensitiveText(text)).toContain('[REDACTED_LARGE_LITERAL]');
  });

  it('preserves normal text', () => {
    const text = 'const x = 42; // normal code';
    expect(redactSensitiveText(text)).toBe(text);
  });

  it('handles empty string', () => {
    expect(redactSensitiveText('')).toBe('');
  });

  it('redacts all secrets in mixed content', () => {
    const text = [
      'const groqKey = "gsk_abcdefghijklmnopqrstuvwxyz123";',
      'const awsKey = "AKIAIOSFODNN7EXAMPLE";',
      'const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3j6K5o6l7sGfQ";',
      'const normal = "hello world";',
    ].join('\n');

    const result = redactSensitiveText(text);

    expect(result).toContain('[REDACTED_SECRET]');
    expect(result).toContain('normal');
    expect(result).toContain('hello world');
    expect(result).not.toContain('gsk_');
    expect(result).not.toContain('AKIA');
    expect(result).not.toContain('eyJhbGci');
  });
});
