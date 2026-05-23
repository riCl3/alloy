import * as vscode from 'vscode';
import { getDiffForFile } from './gitUtils';
import { parseUnifiedDiff, ParsedDiff } from './diffParser';

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Alloy');

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
          return;
        }

        const parsedDiff: ParsedDiff = parseUnifiedDiff(rawDiff, filePath);

        outputChannel.clear();
        outputChannel.appendLine(`[Alloy] Diff for saved file: ${filePath}`);
        outputChannel.appendLine('─'.repeat(60));
        outputChannel.appendLine(rawDiff);
        outputChannel.appendLine('─'.repeat(60));
        outputChannel.appendLine(`Summary: ${parsedDiff.addedLines.length} additions, ${parsedDiff.removedLines.length} deletions`);

        console.log(`[Alloy] Diff for ${filePath}:`);
        console.log(rawDiff);
        console.log(`[Alloy] Summary: ${parsedDiff.addedLines.length} additions, ${parsedDiff.removedLines.length} deletions`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Alloy] Failed to get diff for ${filePath}: ${message}`);
      }
    })
  );
}

export function deactivate() {
  if (outputChannel) {
    outputChannel.dispose();
  }
}
