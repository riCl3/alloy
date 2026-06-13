import { ReviewFinding } from './types';
import { callLLM } from './llmRouter';
import { getAlloyConfig } from './config';

const PR_SYSTEM_PROMPT = `You are a technical writer generating a pull request description from code review findings.
Generate a well-structured markdown PR description with these sections:
## Summary
A 1-2 sentence overview of what the PR changes based on the file list and diff summary.
## Changes
Bullet points describing the key changes.
## Review Findings
Group findings by severity (Errors first, then Warnings, then Info). For each finding include the file, line, and a brief description.
## Testing Notes
Brief suggestions for what should be tested based on the changes and findings.

Keep it concise and professional. Do not include code snippets.`;

export async function generatePRDescription(findings: ReviewFinding[], changedFiles: string[]): Promise<string> {
  const config = getAlloyConfig();

  const findingsSummary = findings.length > 0
    ? findings.map(f => `- [${f.severity}] ${f.category ?? 'general'}: ${f.message} (line ${f.line})`).join('\n')
    : 'No findings.';

  const fileList = changedFiles.map(f => `- ${f}`).join('\n');

  const prompt = `Generate a PR description for these changes.

Changed files:
${fileList}

Review findings:
${findingsSummary}`;

  const response = await callLLM({
    prompt,
    systemPrompt: PR_SYSTEM_PROMPT,
    provider: config.provider,
    model: config.model,
    temperature: 0.3,
    maxTokens: 2048,
  });

  return response.text;
}
