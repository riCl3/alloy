import * as vscode from 'vscode';
import { getFindings } from './findingsStore';
import { ReviewFinding } from './types';

export class AlloyCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const storedFindings = getFindings(document.uri);

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== 'Alloy') continue;

      const line = document.lineAt(diagnostic.range.start.line);
      const lineText = line.text;
      const langId = document.languageId;
      const zeroBasedLine = diagnostic.range.start.line;
      const finding = storedFindings.find((f) => Math.max(0, f.line - 1) === zeroBasedLine);
      const suggestion = finding?.suggestion || diagnostic.message;

      if (finding && canApplyFinding(finding, document)) {
        const applyAction = new vscode.CodeAction(
          `Alloy: Apply fix on line ${zeroBasedLine + 1}`,
          vscode.CodeActionKind.QuickFix,
        );
        applyAction.diagnostics = [diagnostic];
        applyAction.isPreferred = true;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, toVsCodeRange(finding.range!), finding.replacement!);
        applyAction.edit = edit;
        actions.push(applyAction);
      }

      if (suggestion) {
        const { prefix, suffix } = getCommentSyntax(langId);
        const sanitizedSuggestion = sanitizeForComment(suggestion, suffix);
        const commentAction = new vscode.CodeAction(
          `Alloy: Suggest fix on line ${zeroBasedLine + 1}`,
          vscode.CodeActionKind.QuickFix,
        );
        commentAction.diagnostics = [diagnostic];
        const edit = new vscode.WorkspaceEdit();
        edit.insert(
          document.uri,
          new vscode.Position(zeroBasedLine, 0),
          `${prefix}FIXME [Alloy]: ${sanitizedSuggestion}${suffix}\n`,
        );
        commentAction.edit = edit;
        actions.push(commentAction);
      }

      const { prefix: ignorePrefix, suffix: ignoreSuffix } = getCommentSyntax(langId);
      const ignoreAction = new vscode.CodeAction(
        `Alloy: Ignore issue on line ${zeroBasedLine + 1}`,
        vscode.CodeActionKind.QuickFix,
      );
      ignoreAction.diagnostics = [diagnostic];
      const ignoreEdit = new vscode.WorkspaceEdit();
      const indent = lineText.match(/^(\s*)/)?.[1] ?? '';
      ignoreEdit.insert(
        document.uri,
        new vscode.Position(zeroBasedLine, 0),
        `${indent}${ignorePrefix}alloy-disable-next-line${ignoreSuffix}\n`,
      );
      ignoreAction.edit = ignoreEdit;
      actions.push(ignoreAction);

      const copyAction = new vscode.CodeAction(
        `Alloy: Copy suggestion on line ${zeroBasedLine + 1}`,
        vscode.CodeActionKind.QuickFix,
      );
      copyAction.diagnostics = [diagnostic];
      copyAction.command = {
        title: 'Copy suggestion',
        command: 'alloy.copySuggestion',
        arguments: [suggestion],
      };
      actions.push(copyAction);

      const explainAction = new vscode.CodeAction(
        `Alloy: Explain issue on line ${zeroBasedLine + 1}`,
        vscode.CodeActionKind.QuickFix,
      );
      explainAction.diagnostics = [diagnostic];
      explainAction.command = {
        title: 'Explain issue',
        command: 'alloy.showIssue',
        arguments: [diagnostic.message, suggestion, finding?.rationale],
      };
      actions.push(explainAction);
    }

    return actions;
  }
}

export function canApplyFinding(finding: ReviewFinding, document: vscode.TextDocument): boolean {
  if (finding.confidence !== 'high' || !finding.replacement || !finding.range) return false;
  const range = finding.range;
  if (range.startLine < 1 || range.endLine < range.startLine) return false;
  if (range.startCharacter < 0 || range.endCharacter < 0) return false;
  if (range.endLine > document.lineCount) return false;
  const startLine = document.lineAt(range.startLine - 1);
  const endLine = document.lineAt(range.endLine - 1);
  return range.startCharacter <= startLine.text.length && range.endCharacter <= endLine.text.length;
}

function toVsCodeRange(range: NonNullable<ReviewFinding['range']>): vscode.Range {
  return new vscode.Range(
    range.startLine - 1,
    range.startCharacter,
    range.endLine - 1,
    range.endCharacter,
  );
}

function sanitizeForComment(text: string, suffix: string): string {
  let sanitized = text.replace(/[\r\n]+/g, ' ');
  if (suffix === ' -->') {
    sanitized = sanitized.replace(/-->/g, '--&gt;');
  } else if (suffix === ' */') {
    sanitized = sanitized.replace(/\*\//g, '* /');
  }
  return sanitized;
}

function getCommentSyntax(languageId: string): { prefix: string; suffix: string } {
  switch (languageId) {
    case 'python':
    case 'ruby':
    case 'shellscript':
    case 'yaml':
      return { prefix: '# ', suffix: '' };
    case 'html':
    case 'xml':
    case 'vue':
    case 'svelte':
      return { prefix: '<!-- ', suffix: ' -->' };
    case 'php':
      return { prefix: '// ', suffix: '' };
    case 'rust':
    case 'go':
    case 'java':
    case 'c':
    case 'cpp':
    case 'csharp':
    case 'swift':
    case 'kotlin':
    case 'typescript':
    case 'javascript':
    default:
      return { prefix: '// ', suffix: '' };
  }
}
