import { promises as fsp } from 'fs';
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

const MAX_REGEX_COMPLEXITY = 200;

function isRegexSafe(pattern: string): boolean {
  let depth = 0;
  let groups = 0;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '(' || ch === '[') {
      depth++;
      if (ch === '(') groups++;
    } else if (ch === ')' || ch === ']') {
      depth--;
    }
    if (depth > MAX_REGEX_COMPLEXITY || groups > 20) return false;
    if (ch === '*' || ch === '+') {
      const prev = pattern[i - 1];
      if (prev === '(' || prev === '|') return false;
    }
  }
  return depth === 0;
}

export async function loadCustomRules(workspacePath: string): Promise<CustomRule[]> {
  const rulesPath = path.join(workspacePath, '.alloy', 'rules.json');
  try {
    const raw = await fsp.readFile(rulesPath, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((r: unknown) => {
      const rule = r as Record<string, unknown>;
      return rule && rule.id && rule.name && rule.enabled !== false;
    });
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
      if (!rule.pattern || !isRegexSafe(rule.pattern)) continue;
      const regex = new RegExp(rule.pattern, 'i');
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
