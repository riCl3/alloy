import * as vscode from 'vscode';
import { getDiffForFile } from './gitUtils';
import { parseUnifiedDiff } from './diffParser';
import { reviewDiff, initIndexer } from './codeReviewService';
import { ensureApiKeys } from './secretManager';

let outputChannel: vscode.OutputChannel;
let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Alloy');
  diagnosticCollection = vscode.languages.createDiagnosticCollection('alloy');

  context.subscriptions.push(diagnosticCollection);

  ensureApiKeys(context).then((keys) => {
    const groq = keys.groq ? 'set' : 'missing';
    const gemini = keys.gemini ? 'set' : 'missing';
    outputChannel.appendLine(`[Alloy] API keys — Groq: ${groq}, Gemini: ${gemini}`);
  }).catch((err) => {
    outputChannel.appendLine(`[Alloy] Failed to load API keys: ${err.message}`);
  });

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const rootPath = workspaceFolders[0].uri.fsPath;
    initIndexer(rootPath).then(() => {
      outputChannel.appendLine('[Alloy] Repo style indexer initialized');
    }).catch((err) => {
      outputChannel.appendLine(`[Alloy] Indexer init skipped: ${err.message}`);
    });
  }

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
