import * as vscode from 'vscode';
import { getDiffForFile } from './gitUtils';
import { parseUnifiedDiff } from './diffParser';
import { reviewDiff, initIndexer } from './codeReviewService';
import { ensureApiKeys } from './secretManager';

let outputChannel: vscode.OutputChannel;
let diagnosticCollection: vscode.DiagnosticCollection;
let apiKeysReady: Promise<{ groq: string; gemini: string }>;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Alloy');
  diagnosticCollection = vscode.languages.createDiagnosticCollection('alloy');

  context.subscriptions.push(diagnosticCollection);

  apiKeysReady = ensureApiKeys(context).then((keys) => {
    const groq = keys.groq ? 'set' : 'missing';
    const gemini = keys.gemini ? 'set' : 'missing';
    outputChannel.appendLine(`[Alloy] API keys — Groq: ${groq}, Gemini: ${gemini}`);
    return keys;
  }).catch((err) => {
    outputChannel.appendLine(`[Alloy] Failed to load API keys: ${err.message}`);
    return { groq: '', gemini: '' };
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

  const disposable = vscode.commands.registerCommand(
    'reviewbot.reviewCurrentFile',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor to review.');
        return;
      }

      const document = editor.document;
      if (document.uri.scheme !== 'file') {
        vscode.window.showWarningMessage('Cannot review unsaved or non-file documents.');
        return;
      }

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!workspaceFolder) {
        vscode.window.showWarningMessage('File is not in a workspace folder.');
        return;
      }

      const filePath = document.uri.fsPath;
      const repoPath = workspaceFolder.uri.fsPath;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Alloy: Reviewing code...',
          cancellable: false,
        },
        async () => {
          try {
            outputChannel.clear();
            outputChannel.appendLine(`[Alloy] Starting review for: ${filePath}`);
            outputChannel.appendLine(`[Alloy] Repo path: ${repoPath}`);
            console.log(`[Alloy] Starting review for: ${filePath}`);

            const keys = await apiKeysReady;
            if (!keys.groq && !keys.gemini) {
              outputChannel.appendLine(`[Alloy] No API keys available. Aborting.`);
              vscode.window.showErrorMessage('Alloy: No API keys configured. Please restart and enter your keys.');
              return;
            }

            console.log(`[Alloy] Calling getDiffForFile...`);
            const rawDiff = await getDiffForFile(filePath, { repoPath });
            console.log(`[Alloy] getDiffForFile returned: ${rawDiff.length} chars`);
            outputChannel.appendLine(`[Alloy] Diff length: ${rawDiff.length} chars`);

            if (!rawDiff) {
              diagnosticCollection.set(document.uri, []);
              outputChannel.appendLine(`[Alloy] No diff found for ${filePath}`);
              vscode.window.showWarningMessage('Alloy: No diff found for this file. Make sure the file has uncommitted changes.');
              return;
            }

            const parsedDiff = parseUnifiedDiff(rawDiff, filePath);
            outputChannel.appendLine('─'.repeat(60));
            outputChannel.appendLine(rawDiff);
            outputChannel.appendLine('─'.repeat(60));
            outputChannel.appendLine(
              `Summary: ${parsedDiff.addedLines.length} additions, ${parsedDiff.removedLines.length} deletions`,
            );

            const modifiedLines = parsedDiff.addedLines.map((l) => l.lineNumber);
            const sourceCode = document.getText();

            console.log(`[Alloy] Calling reviewDiff with ${modifiedLines.length} modified lines...`);
            outputChannel.appendLine(`[Alloy] Sending to AI for review (${modifiedLines.length} modified lines)...`);

            await reviewDiff({
              diff: rawDiff,
              sourceCode,
              filePath,
              modifiedLines,
              uri: document.uri,
              diagnosticCollection,
            });

            const count = diagnosticCollection.get(document.uri)?.length ?? 0;
            outputChannel.appendLine(`[Alloy] Review complete: ${count} finding(s)`);
            if (count > 0) {
              vscode.window.showInformationMessage(`Alloy: ${count} issue(s) found. Check the Problems panel (Ctrl+Shift+M).`);
            } else {
              vscode.window.showInformationMessage('Alloy: No issues found. Check the Output panel for details.');
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[Alloy] Failed to review ${filePath}: ${message}`);
            outputChannel.appendLine(`[Alloy] Error: ${message}`);
            vscode.window.showErrorMessage(`Alloy review failed: ${message}`);
          }
        },
      );
    },
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {
  if (outputChannel) {
    outputChannel.dispose();
  }
}
