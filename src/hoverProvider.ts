/**
 * HoverProvider for Alloy findings.
 *
 * When a user hovers over a line that has an Alloy finding,
 * shows a rich Markdown hover card with the finding details.
 */

import * as vscode from 'vscode';
import { Severity, FindingCategory } from './types';
import { AlloyFindingsTree } from './findingsTree';

const SEVERITY_EMOJI: Record<Severity, string> = {
  error: '🔴',
  warning: '🟡',
  info: '🔵',
};

const CATEGORY_LABELS: Record<FindingCategory, string> = {
  security: 'Security',
  logic: 'Logic',
  quality: 'Quality',
  performance: 'Performance',
  test: 'Test',
};

export class AlloyHoverProvider implements vscode.HoverProvider {
  constructor(private readonly findingsTree: AlloyFindingsTree) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Hover> {
    const findings = this.findingsTree.getFindings(document.uri);
    if (findings.length === 0) return undefined;

    // Find findings on the hovered line (1-based)
    const line = position.line + 1;
    const lineFindings = findings.filter(f => f.line === line);
    if (lineFindings.length === 0) return undefined;

    // Build hover content
    const md = new vscode.MarkdownString();
    md.isTrusted = false;
    md.supportHtml = false;

    for (let i = 0; i < lineFindings.length; i++) {
      const f = lineFindings[i];
      if (i > 0) {
        md.appendMarkdown(`\n\n---\n\n`);
      }

      // Header
      const emoji = SEVERITY_EMOJI[f.severity] ?? '⚪';
      md.appendMarkdown(`${emoji} **${f.severity.toUpperCase()}**`);
      if (f.category) {
        md.appendMarkdown(` · ${CATEGORY_LABELS[f.category]}`);
      }
      if (f.confidence) {
        md.appendMarkdown(` · ${f.confidence} confidence`);
      }
      md.appendMarkdown(`\n\n`);

      // Message
      md.appendMarkdown(`${f.message}\n\n`);

      // Suggestion
      if (f.suggestion) {
        md.appendMarkdown(`💡 *${f.suggestion}*\n\n`);
      }

      // Rationale
      if (f.rationale) {
        md.appendMarkdown(`${f.rationale}\n\n`);
      }

      // Replacement preview
      if (f.replacement) {
        md.appendMarkdown(`**Proposed fix:**\n\n`);
        md.appendCodeblock(f.replacement, document.languageId);
      }
    }

    // Add a footer with available actions
    md.appendMarkdown(`\n---\n`);
    md.appendMarkdown(`*$(lightbulb) Quick fix available · $(close) Dismiss · $(copy) Copy*`);

    const range = new vscode.Range(line - 1, 0, line - 1, Number.MAX_SAFE_INTEGER);
    return new vscode.Hover(md, range);
  }
}
