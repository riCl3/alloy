import { redactSensitiveText } from '../redaction';

describe('redaction', () => {
  it('redacts Groq API keys', () => {
    const text = 'Using key gsk_abcdefghijklmnopqrstuvwx';
    const result = redactSensitiveText(text);
    // The pattern keeps the prefix and adds [REDACTED]
    expect(result).toContain('[REDACTED]');
  });

  it('redacts Gemini API keys', () => {
    const text = 'Key: AIzaSyAabcdefghijklmnopqrstuv';
    const result = redactSensitiveText(text);
    // The pattern keeps the prefix and redacts the rest
    expect(result).toContain('[REDACTED]');
  });

  it('redacts OpenAI API keys', () => {
    const text = 'sk-abcdefghijklmnopqrstuvwxyz123456';
    expect(redactSensitiveText(text)).toContain('[REDACTED]');
  });

  it('redacts GitHub tokens', () => {
    const text = 'ghp_abcdefghijklmnopqrstuvwxyz';
    expect(redactSensitiveText(text)).toContain('[REDACTED]');
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
    expect(redactSensitiveText(text)).toContain('[REDACTED]');
  });

  it('redacts API_KEY assignments', () => {
    const text = 'MY_API_KEY = keyvalue123';
    expect(redactSensitiveText(text)).toContain('[REDACTED]');
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
});
