import { ReviewFinding } from '../../../types';

export function createMockLlmResponse(findings: ReviewFinding[]): string {
  return JSON.stringify({ findings });
}

export function createEmptyLlmResponse(): string {
  return JSON.stringify({ findings: [] });
}

export function createFindingsForLine(
  line: number,
  count: number,
  category: ReviewFinding['category'] = 'logic',
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (let i = 0; i < count; i++) {
    findings.push({
      line,
      severity: i % 3 === 0 ? 'error' : i % 3 === 1 ? 'warning' : 'info',
      message: `Finding ${i + 1} on line ${line} - ${category} issue`,
      suggestion: `Suggestion ${i + 1}: Fix the ${category} issue at line ${line}`,
      category,
      confidence: i % 2 === 0 ? 'high' : 'medium',
    });
  }
  return findings;
}

export function createFindingsAcrossLines(
  lines: number[],
  findingsPerLine: number,
  category: ReviewFinding['category'] = 'logic',
): ReviewFinding[] {
  const all: ReviewFinding[] = [];
  for (const line of lines) {
    all.push(...createFindingsForLine(line, findingsPerLine, category));
  }
  return all;
}

export function createMixedFindings(count: number): ReviewFinding[] {
  const categories: ReviewFinding['category'][] = ['security', 'logic', 'quality', 'performance', 'test'];
  const severities: ReviewFinding['severity'][] = ['error', 'warning', 'info'];
  const findings: ReviewFinding[] = [];

  for (let i = 0; i < count; i++) {
    findings.push({
      line: (i % 50) + 1,
      severity: severities[i % 3],
      message: `Mixed finding ${i + 1}: ${categories[i % 5]} issue at line ${(i % 50) + 1}`,
      suggestion: `Fix ${categories[i % 5]} issue at line ${(i % 50) + 1}`,
      category: categories[i % 5],
      confidence: i % 3 === 0 ? 'high' : i % 3 === 1 ? 'medium' : 'low',
    });
  }

  return findings;
}
