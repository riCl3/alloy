import * as vscode from 'vscode';
import * as path from 'path';
import { ReviewFinding } from './types';

export function exportFindingsJSON(allFindingsMap: Map<string, ReviewFinding[]>): string {
  const result: Record<string, ReviewFinding[]> = {};
  for (const [uriKey, findings] of allFindingsMap) {
    result[uriKey] = findings;
  }
  return JSON.stringify(result, null, 2);
}

export function exportFindingsMarkdown(allFindingsMap: Map<string, ReviewFinding[]>): string {
  const allFindings: { file: string; finding: ReviewFinding }[] = [];
  for (const [uriKey, findings] of allFindingsMap) {
    const fileName = path.basename(vscode.Uri.parse(uriKey).fsPath);
    for (const f of findings) {
      allFindings.push({ file: fileName, finding: f });
    }
  }

  const errors = allFindings.filter(f => f.finding.severity === 'error').length;
  const warnings = allFindings.filter(f => f.finding.severity === 'warning').length;
  const infos = allFindings.filter(f => f.finding.severity === 'info').length;

  let md = `# Alloy Code Review Report\n\n`;
  md += `**Generated:** ${new Date().toISOString()}\n\n`;
  md += `## Summary\n\n`;
  md += `| Severity | Count |\n|---|---|\n`;
  md += `| Errors | ${errors} |\n`;
  md += `| Warnings | ${warnings} |\n`;
  md += `| Info | ${infos} |\n`;
  md += `| **Total** | **${allFindings.length}** |\n\n`;

  if (allFindings.length === 0) {
    md += `No issues found.\n`;
    return md;
  }

  md += `## Findings\n\n`;

  // Group by file
  const byFile = new Map<string, ReviewFinding[]>();
  for (const { file, finding } of allFindings) {
    const arr = byFile.get(file) ?? [];
    arr.push(finding);
    byFile.set(file, arr);
  }

  for (const [file, findings] of byFile) {
    md += `### ${file}\n\n`;
    md += `| Line | Severity | Category | Message | Suggestion |\n`;
    md += `|---|---|---|---|---|\n`;
    for (const f of findings) {
      const category = f.category ?? 'general';
      const message = f.message.replace(/\|/g, '\\|');
      const suggestion = (f.suggestion ?? '').replace(/\|/g, '\\|');
      md += `| ${f.line} | ${f.severity} | ${category} | ${message} | ${suggestion} |\n`;
    }
    md += `\n`;
  }

  return md;
}
