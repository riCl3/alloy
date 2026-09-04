/**
 * CodeLens provider for Alloy findings.
 *
 * Shows a summary line at the top of reviewed files with clickable actions:
 * "N issues found — Review · Clear · Group by..."
 */

import * as vscode from 'vscode';
import { AlloyFindingsTree } from './findingsTree';

export class AlloyCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(private readonly findingsTree: AlloyFindingsTree) {
    // Re-render lenses when findings change
    findingsTree.onDidChangeFindings(() => this._onDidChangeCodeLenses.fire());
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const findings = this.findingsTree.getFindings(document.uri);
    if (findings.length === 0) return [];

    const errors = findings.filter(f => f.severity === 'error').length;
    const warnings = findings.filter(f => f.severity === 'warning').length;
    const infos = findings.filter(f => f.severity === 'info').length;

    const parts: string[] = [];
    if (errors > 0) parts.push(`${errors} error${errors > 1 ? 's' : ''}`);
    if (warnings > 0) parts.push(`${warnings} warning${warnings > 1 ? 's' : ''}`);
    if (infos > 0) parts.push(`${infos} info`);

    const summaryText = `$(warning) Alloy: ${findings.length} issue${findings.length > 1 ? 's' : ''} (${parts.join(', ')})`;

    const range = new vscode.Range(0, 0, 0, 0);
    const summaryLens = new vscode.CodeLens(range, {
      title: summaryText,
      command: 'alloyFindings.focus',
      tooltip: 'Focus Alloy Findings panel',
    });

    const clearLens = new vscode.CodeLens(range, {
      title: '$(clear-all) Clear',
      command: 'alloy.clearFindings',
      tooltip: 'Clear all findings',
    });

    const reviewLens = new vscode.CodeLens(range, {
      title: '$(refresh) Re-review',
      command: 'alloy.reviewCurrentFile',
      tooltip: 'Re-run code review',
    });

    return [summaryLens, clearLens, reviewLens];
  }
}
