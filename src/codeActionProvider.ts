import * as vscode from 'vscode';
import { getFindings } from './findingsStore';

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

      // Try to find matching finding from store
      const finding = storedFindings.find(
        (f) => Math.max(0, f.line - 1) === zeroBasedLine,
      );
      const suggestion = finding?.suggestion || diagnostic.message;

      // "Show explanation" action — works with or without stored finding
      const explainAction = new vscode.CodeAction(
        `Alloy: Explain issue on line ${zeroBasedLine + 1}`,
        vscode.CodeActionKind.QuickFix,
      );
      explainAction.diagnostics = [diagnostic];
      explainAction.command = {
        title: 'Explain issue',
        command: 'alloy.showIssue',
        arguments: [diagnostic.message, suggestion],
      };

      // "Insert fix as comment" action — always shown if we have any message text
      if (suggestion) {
        const { prefix, suffix } = getCommentSyntax(langId);
        const sanitizedSuggestion = sanitizeForComment(suggestion, suffix);
        const commentAction = new vscode.CodeAction(
          `Alloy: Suggest fix on line ${zeroBasedLine + 1}`,
          vscode.CodeActionKind.QuickFix,
        );
        commentAction.diagnostics = [diagnostic];
        commentAction.isPreferred = true;
        const edit = new vscode.WorkspaceEdit();
        edit.insert(
          document.uri,
          new vscode.Position(zeroBasedLine, 0),
          `${prefix}FIXME [Alloy]: ${sanitizedSuggestion}${suffix}\n`,
        );
        commentAction.edit = edit;
        actions.push(commentAction);
      }

      // "Ignore this finding" action — always shown
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

      actions.push(explainAction);
    }

    return actions;
  }
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
      return { prefix: '<!-- ', suffix: ' -->' };
    default:
      return { prefix: '// ', suffix: '' };
  }
}
