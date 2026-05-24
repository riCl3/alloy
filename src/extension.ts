import * as vscode from 'vscode';
import * as path from 'path';
import { getDiffForFile, getHeadContent } from './gitUtils';
import { parseUnifiedDiff } from './diffParser';
import { reviewDiff, initIndexer } from './codeReviewService';
import { ensureApiKeys } from './secretManager';
import { AlloyCodeActionProvider } from './codeActionProvider';

const HEAD_SCHEME = 'alloy-head';

let outputChannel: vscode.OutputChannel;
let diagnosticCollection: vscode.DiagnosticCollection;
let apiKeysReady: Promise<{ groq: string; gemini: string }>;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Alloy');
  diagnosticCollection = vscode.languages.createDiagnosticCollection('alloy');

  context.subscriptions.push(outputChannel);
  context.subscriptions.push(diagnosticCollection);

  // Register virtual document provider for HEAD version (used in diff view)
  const headProvider = new (class implements vscode.TextDocumentContentProvider {
    private cache = new Map<string, string>();
    setHead(filePath: string, content: string) {
      this.cache.set(filePath, content);
    }
    clearCache() {
      this.cache.clear();
    }
    provideTextDocumentContent(uri: vscode.Uri): string {
      return this.cache.get(uri.path) ?? '';
    }
  })();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(HEAD_SCHEME, headProvider));

  // Register code action provider for inline quick fixes
  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    { scheme: 'file' },
    new AlloyCodeActionProvider(),
    { providedCodeActionKinds: AlloyCodeActionProvider.providedCodeActionKinds },
  );
  context.subscriptions.push(codeActionProvider);

  // Register show issue command (called from CodeAction)
  const showIssueCmd = vscode.commands.registerCommand('alloy.showIssue', (message: string, suggestion: string) => {
    const detail = suggestion ? `${message}\n\nSuggestion: ${suggestion}` : message;
    vscode.window.showInformationMessage(`[Alloy] ${detail}`, 'Copy').then((action) => {
      if (action === 'Copy') {
        vscode.env.clipboard.writeText(detail);
      }
    });
  });
  context.subscriptions.push(showIssueCmd);

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
    const cachePath = path.join(context.globalStorageUri.fsPath, 'index');
    initIndexer(rootPath, cachePath).then(() => {
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
            headProvider.clearCache();
            outputChannel.appendLine(`[Alloy] Starting review for: ${filePath}`);
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
              vscode.window.showWarningMessage('Alloy: No diff found. Make sure the file has uncommitted changes.');
              return;
            }

            const parsedDiff = parseUnifiedDiff(rawDiff, filePath);
            outputChannel.appendLine(
              `Summary: ${parsedDiff.addedLines.length} additions, ${parsedDiff.removedLines.length} deletions`,
            );

            // Show split-screen diff view (HEAD vs working copy)
            try {
              const headContent = await getHeadContent(filePath, { repoPath });
              if (headContent !== null) {
                headProvider.setHead(filePath, headContent);
                const headUri = vscode.Uri.parse(`${HEAD_SCHEME}:${filePath}`);
                const fileName = path.basename(filePath);
                vscode.commands.executeCommand('vscode.diff', headUri, document.uri, `Alloy: ${fileName} (HEAD ↔ Working)`);
              }
            } catch (err) {
              outputChannel.appendLine(`[Alloy] Could not show diff view: ${(err as Error).message}`);
            }

            const modifiedLines = parsedDiff.addedLines.map((l) => l.lineNumber);
            const sourceCode = document.getText();

            console.log(`[Alloy] Calling reviewDiff with ${modifiedLines.length} modified lines...`);
            outputChannel.appendLine(`[Alloy] Sending to AI for review...`);

            await reviewDiff({
              diff: rawDiff,
              sourceCode,
              filePath,
              modifiedLines,
              uri: document.uri,
              diagnosticCollection,
            });

            const diagnostics = diagnosticCollection.get(document.uri) ?? [];
            const count = diagnostics.length;
            outputChannel.appendLine(`[Alloy] Review complete: ${count} finding(s)`);
            if (count > 0) {
              vscode.window.showInformationMessage(`Alloy: ${count} issue(s) found. Check Problems panel (Ctrl+Shift+M).`);
            } else {
              vscode.window.showInformationMessage('Alloy: No issues found.');
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
