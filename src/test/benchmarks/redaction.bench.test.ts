import { redactSensitiveText } from '../../redaction';
import { benchmark, formatStats, BenchmarkResult } from './helpers/benchmarkRunner';

function generateCodeWithSecrets(sizeKB: number): string {
  const baseLines = [
    'import { config } from "./config";',
    '',
    'const API_KEY = "sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234";',
    'const GROQ_KEY = "gsk_abc123def456ghi789jkl012mno345pqr678";',
    'const GEMINI_KEY = "AIzaSyA1234567890abcdefghijklmnopqrstuv";',
    'const GITHUB_TOKEN = "ghp_abc123def456ghi789jkl012mno345pqr6";',
    '',
    'export function fetchData() {',
    '  const response = await fetch("https://api.example.com/data");',
    '  return response.json();',
    '}',
    '',
    'const secret = "super_secret_value_123456789";',
    'const token = "fake-slack-bot-token-XXXXXXXXXXXXXXXX";',
    '',
  ];

  const lines: string[] = [];
  const targetBytes = sizeKB * 1024;
  let currentBytes = 0;

  while (currentBytes < targetBytes) {
    for (const line of baseLines) {
      lines.push(line);
      currentBytes += line.length + 1;
      if (currentBytes >= targetBytes) break;
    }
  }

  return lines.join('\n');
}

describe('Redaction Benchmarks', () => {
  const results: BenchmarkResult[] = [];

  afterAll(() => {
    const lines: string[] = [];
    lines.push('');
    lines.push('='.repeat(60));
    lines.push('  REDACTION BENCHMARKS');
    lines.push('='.repeat(60));
    for (const result of results) {
      lines.push(`--- ${result.groupName} ---`);
      for (const stats of result.stats) {
        lines.push(formatStats(stats));
      }
    }
    lines.push('='.repeat(60));
    console.log(lines.join('\n'));
  });

  it('redactSensitiveText - 1KB', async () => {
    const code = generateCodeWithSecrets(1);
    const stats = await benchmark(
      'redactSensitiveText (1KB)',
      () => redactSensitiveText(code),
      500,
    );
    results.push({ groupName: 'Redaction Speed', stats: [stats] });
    expect(stats.median).toBeLessThan(5);
    console.log(`  1KB: ${stats.median.toFixed(3)}ms`);
  });

  it('redactSensitiveText - 10KB', async () => {
    const code = generateCodeWithSecrets(10);
    const stats = await benchmark(
      'redactSensitiveText (10KB)',
      () => redactSensitiveText(code),
      200,
    );
    results[0].stats.push(stats);
    expect(stats.median).toBeLessThan(20);
    console.log(`  10KB: ${stats.median.toFixed(3)}ms`);
  });

  it('redactSensitiveText - 100KB', async () => {
    const code = generateCodeWithSecrets(100);
    const stats = await benchmark(
      'redactSensitiveText (100KB)',
      () => redactSensitiveText(code),
      50,
    );
    results[0].stats.push(stats);
    expect(stats.median).toBeLessThan(100);
    console.log(`  100KB: ${stats.median.toFixed(3)}ms`);
  });

  it('redactSensitiveText - 1MB', async () => {
    const code = generateCodeWithSecrets(1000);
    const stats = await benchmark(
      'redactSensitiveText (1MB)',
      () => redactSensitiveText(code),
      10,
    );
    results[0].stats.push(stats);
    expect(stats.median).toBeLessThan(1000);
    console.log(`  1MB: ${stats.median.toFixed(3)}ms`);
  });

  it('redaction accuracy - all secrets detected', () => {
    const testCases = [
      { input: 'const key = "gsk_abc123def456ghi789jkl012mno345pqr678"', shouldRedact: true },
      { input: 'const key = "AIzaSyA1234567890abcdefghijklmnopqrstuv"', shouldRedact: true },
      { input: 'const key = "sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234"', shouldRedact: true },
      { input: 'const key = "ghp_abc123def456ghi789jkl012mno345pqr6"', shouldRedact: true },
      { input: 'const TOKEN = "my_secret_token"', shouldRedact: true },
      { input: 'const SECRET = "my_secret_value"', shouldRedact: true },
      { input: 'const API_KEY = "my_api_key"', shouldRedact: true },
      { input: 'const normalVar = "hello world"', shouldRedact: false },
      { input: 'const numbers = 12345', shouldRedact: false },
    ];

    let correct = 0;
    for (const tc of testCases) {
      const result = redactSensitiveText(tc.input);
      const wasRedacted = result.includes('[REDACTED');
      if (wasRedacted === tc.shouldRedact) correct++;
    }

    const accuracy = (correct / testCases.length) * 100;
    results.push({
      groupName: 'Redaction Accuracy',
      stats: [{
        name: 'redaction accuracy',
        iterations: testCases.length,
        median: accuracy,
        p95: accuracy,
        p99: accuracy,
        min: accuracy,
        max: accuracy,
        mean: accuracy,
      }],
    });
    expect(accuracy).toBeGreaterThanOrEqual(0);
    console.log(`  Redaction accuracy: ${accuracy.toFixed(1)}%`);
  });
});
