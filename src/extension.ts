import * as vscode from 'vscode';
import { getDiffForFile } from './gitUtils';
import { parseUnifiedDiff } from './diffParser';
import { reviewDiff } from './codeReviewService';

let outputChannel: vscode.OutputChannel;
let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Alloy');
  diagnosticCollection = vscode.languages.createDiagnosticCollection('alloy');

  context.subscriptions.push(diagnosticCollection);

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
      if (document.uri.scheme !== 'file') {
        return;
      }

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!workspaceFolder) {
        return;
      }

      const filePath = document.uri.fsPath;
      const repoPath = workspaceFolder.uri.fsPath;

      try {
        const rawDiff = await getDiffForFile(filePath, { repoPath });

        if (!rawDiff) {
          diagnosticCollection.set(document.uri, []);
          return;
        }

        const parsedDiff = parseUnifiedDiff(rawDiff, filePath);

        outputChannel.clear();
        outputChannel.appendLine(`[Alloy] Reviewing: ${filePath}`);
        outputChannel.appendLine('─'.repeat(60));
        outputChannel.appendLine(rawDiff);
        outputChannel.appendLine('─'.repeat(60));
        outputChannel.appendLine(
          `Summary: ${parsedDiff.addedLines.length} additions, ${parsedDiff.removedLines.length} deletions`,
        );

        console.log(`[Alloy] Diff for ${filePath}:`);
        console.log(rawDiff);
        console.log(
          `[Alloy] Summary: ${parsedDiff.addedLines.length} additions, ${parsedDiff.removedLines.length} deletions`,
        );

        const modifiedLines = parsedDiff.addedLines.map((l) => l.lineNumber);
        const sourceCode = document.getText();

        await reviewDiff({
          diff: rawDiff,
          sourceCode,
          filePath,
          modifiedLines,
          uri: document.uri,
          diagnosticCollection,
        });

        console.log(`[Alloy] Review complete for ${filePath}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Alloy] Failed to review ${filePath}: ${message}`);
        outputChannel.appendLine(`[Alloy] Error: ${message}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnosticCollection.set(document.uri, []);
    }),
  );
}

export function deactivate() {
  if (outputChannel) {
    outputChannel.dispose();
  }
}
