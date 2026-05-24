import * as vscode from 'vscode';
import * as path from 'path';
import { getDiffForFile, getHeadContent } from './gitUtils';
import { parseUnifiedDiff, buildEnumeratedDiff } from './diffParser';
import { reviewDiff, initIndexer } from './codeReviewService';
import { ensureApiKeys } from './secretManager';
import { AlloyCodeActionProvider } from './codeActionProvider';
import { AlloyCommentController } from './commentController';

const HEAD_SCHEME = 'alloy-head';

let outputChannel: vscode.OutputChannel;
let diagnosticCollection: vscode.DiagnosticCollection;
let commentController: AlloyCommentController;
let apiKeysReady: Promise<{ groq: string; gemini: string }>;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Alloy');
  diagnosticCollection = vscode.languages.createDiagnosticCollection('alloy');

  context.subscriptions.push(outputChannel);
  context.subscriptions.push(diagnosticCollection);

  commentController = new AlloyCommentController();
  context.subscriptions.push({ dispose: () => commentController.dispose() });

  // Status bar item for background review state
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.tooltip = 'Alloy is reviewing your code';
  statusBarItem.hide();
  context.subscriptions.push(statusBarItem);

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

  // Debounced auto-review on save
  let debounceTimer: NodeJS.Timeout | undefined;
  const saveListener = vscode.workspace.onDidSaveTextDocument((doc: vscode.TextDocument) => {
    if (doc.uri.scheme !== 'file') return;
    if (!vscode.workspace.getWorkspaceFolder(doc.uri)) return;
    if (!vscode.workspace.getConfiguration('alloy').get<boolean>('reviewOnSave', true)) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      vscode.commands.executeCommand('reviewbot.reviewCurrentFile', { autoTrigger: true });
    }, 2000);
  });
  context.subscriptions.push(saveListener);

  const disposable = vscode.commands.registerCommand(
    'reviewbot.reviewCurrentFile',
    async (args?: { autoTrigger?: boolean }) => {
      const isAutoTrigger = args?.autoTrigger === true;

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        if (!isAutoTrigger) vscode.window.showWarningMessage('No active editor to review.');
        return;
      }

      const document = editor.document;
      if (document.uri.scheme !== 'file') {
        if (!isAutoTrigger) vscode.window.showWarningMessage('Cannot review unsaved or non-file documents.');
        return;
      }

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!workspaceFolder) {
        if (!isAutoTrigger) vscode.window.showWarningMessage('File is not in a workspace folder.');
        return;
      }

      const filePath = document.uri.fsPath;
      const repoPath = workspaceFolder.uri.fsPath;

      // Show status bar for auto-trigger; keep notification for manual
      if (isAutoTrigger) {
        statusBarItem.text = '$(sync~spin) Alloy Reviewing...';
        statusBarItem.show();
      }

      await vscode.window.withProgress(
        {
          location: isAutoTrigger ? vscode.ProgressLocation.Window : vscode.ProgressLocation.Notification,
          title: 'Alloy: Reviewing code...',
          cancellable: false,
        },
        async () => {
          try {
            outputChannel.clear();
            headProvider.clearCache();
            outputChannel.appendLine(`[Alloy] Starting review for: ${filePath}${isAutoTrigger ? ' (auto)' : ''}`);
            console.log(`[Alloy] Starting review for: ${filePath}`);

            const keys = await apiKeysReady;
            if (!keys.groq && !keys.gemini) {
              outputChannel.appendLine(`[Alloy] No API keys available. Aborting.`);
              if (!isAutoTrigger) vscode.window.showErrorMessage('Alloy: No API keys configured. Please restart and enter your keys.');
              return;
            }

            console.log(`[Alloy] Calling getDiffForFile...`);
            const rawDiff = await getDiffForFile(filePath, { repoPath });
            console.log(`[Alloy] getDiffForFile returned: ${rawDiff.length} chars`);
            outputChannel.appendLine(`[Alloy] Diff length: ${rawDiff.length} chars`);

            if (!rawDiff) {
              diagnosticCollection.set(document.uri, []);
              outputChannel.appendLine(`[Alloy] No diff found for ${filePath}`);
              if (!isAutoTrigger) vscode.window.showWarningMessage('Alloy: No diff found. Make sure the file has uncommitted changes.');
              return;
            }

            const parsedDiff = parseUnifiedDiff(rawDiff, filePath);
            outputChannel.appendLine(
              `Summary: ${parsedDiff.addedLines.length} additions, ${parsedDiff.removedLines.length} deletions`,
            );

            // Show split-screen diff view (HEAD vs working copy) — only for manual
            if (!isAutoTrigger) {
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
            }

            const modifiedLines = parsedDiff.addedLines.map((l) => l.lineNumber);
            const enumeratedDiff = buildEnumeratedDiff(parsedDiff);
            const sourceCode = document.getText();

            console.log(`[Alloy] Calling reviewDiff with ${modifiedLines.length} modified lines...`);
            outputChannel.appendLine(`[Alloy] Sending to AI for review...`);

            await reviewDiff({
              diff: rawDiff,
              enumeratedDiff,
              sourceCode,
              filePath,
              modifiedLines,
              uri: document.uri,
              diagnosticCollection,
              commentController,
            });

            const diagnostics = diagnosticCollection.get(document.uri) ?? [];
            const count = diagnostics.length;
            outputChannel.appendLine(`[Alloy] Review complete: ${count} finding(s)`);
            if (count > 0) {
              const msg = `Alloy: ${count} issue(s) found. Check Problems panel (Ctrl+Shift+M).`;
              if (isAutoTrigger) {
                outputChannel.appendLine(msg);
              } else {
                vscode.window.showInformationMessage(msg);
              }
            } else {
              const msg = 'Alloy: No issues found.';
              if (isAutoTrigger) {
                outputChannel.appendLine(msg);
              } else {
                vscode.window.showInformationMessage(msg);
              }
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[Alloy] Failed to review ${filePath}: ${message}`);
            outputChannel.appendLine(`[Alloy] Error: ${message}`);
            if (!isAutoTrigger) vscode.window.showErrorMessage(`Alloy review failed: ${message}`);
          } finally {
            statusBarItem.hide();
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
