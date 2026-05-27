import * as fs from 'fs';
import * as path from 'path';
import { FindingCategory, ReviewFinding, Severity } from './types';

export interface CustomRule {
  id: string;
  name: string;
  description: string;
  severity: Severity;
  category: FindingCategory;
  pattern?: string;
  prompt?: string;
  enabled: boolean;
}

export function loadCustomRules(workspacePath: string): CustomRule[] {
  const rulesPath = path.join(workspacePath, '.alloy', 'rules.json');
  try {
    const raw = fs.readFileSync(rulesPath, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((r: any) => r && r.id && r.name && r.enabled !== false);
  } catch {
    return [];
  }
}

export function buildCustomRulesPrompt(rules: CustomRule[]): string {
  const promptRules = rules.filter(r => r.prompt);
  if (promptRules.length === 0) return '';
  const lines = promptRules.map(r => `- ${r.name}: ${r.prompt}`);
  return `\n\nAdditional review rules:\n${lines.join('\n')}`;
}

export function applyPatternRules(rules: CustomRule[], diff: string): ReviewFinding[] {
  const patternRules = rules.filter(r => r.pattern);
  if (patternRules.length === 0) return [];

  const findings: ReviewFinding[] = [];
  const diffLines = diff.split(/\r?\n/);

  for (const rule of patternRules) {
    try {
      const regex = new RegExp(rule.pattern!, 'i');
      for (let i = 0; i < diffLines.length; i++) {
        const line = diffLines[i];
        if (!line.startsWith('+') || line.startsWith('+++')) continue;
        if (regex.test(line)) {
          findings.push({
            line: i + 1,
            severity: rule.severity,
            message: rule.name,
            suggestion: rule.description,
            category: rule.category,
          });
        }
      }
    } catch {
      // Invalid regex pattern — skip rule
    }
  }

  return findings;
}
