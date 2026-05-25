import * as vscode from 'vscode';
import * as path from 'path';
import { getChangedFiles, getDiffForFile, getHeadContent } from './gitUtils';
import { parseUnifiedDiff, buildEnumeratedDiff } from './diffParser';
import { reviewDiff } from './codeReviewService';
import { ensureProviderReady, setupProvider } from './secretManager';
import { validateProvider } from './llmRouter';
import { AlloyCodeActionProvider } from './codeActionProvider';
import { AlloyCommentController } from './commentController';
import { AlloyFindingsTree } from './findingsTree';
import { getAlloyConfig, providerDefaultModel } from './config';
import { LLMProviderId, ReviewFinding } from './types';
import { clearFindings, getFindings } from './findingsStore';
import { clearReviewCache } from './reviewCache';
import { isSupportedSourceFile, shouldSkipPath } from './ignore';

const HEAD_SCHEME = 'alloy-head';

let outputChannel: vscode.OutputChannel;
let diagnosticCollection: vscode.DiagnosticCollection;
let commentController: AlloyCommentController;
let findingsTree: AlloyFindingsTree;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Alloy');
  diagnosticCollection = vscode.languages.createDiagnosticCollection('alloy');
  commentController = new AlloyCommentController();
  findingsTree = new AlloyFindingsTree();

  context.subscriptions.push(outputChannel, diagnosticCollection, { dispose: () => commentController.dispose() });
  context.subscriptions.push(vscode.window.createTreeView('alloyFindings', { treeDataProvider: findingsTree }));

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.tooltip = 'Alloy review status';
  statusBarItem.hide();
  context.subscriptions.push(statusBarItem);

  const headProvider = createHeadProvider();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(HEAD_SCHEME, headProvider));

  context.subscriptions.push(vscode.languages.registerCodeActionsProvider(
    { scheme: 'file' },
    new AlloyCodeActionProvider(),
    { providedCodeActionKinds: AlloyCodeActionProvider.providedCodeActionKinds },
  ));

  registerCommands(context, statusBarItem, headProvider);
  registerAutoReview(context);

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const rootPath = workspaceFolders[0].uri.fsPath;
    const cachePath = path.join(context.globalStorageUri.fsPath, 'index');
    import('./codeReviewService').then(({ initIndexer }) => initIndexer(rootPath, cachePath))
      .then(() => outputChannel.appendLine('[Alloy] Repo style indexer initialized'))
      .catch((err) => outputChannel.appendLine(`[Alloy] Indexer init skipped: ${(err as Error).message}`));
  }

  const config = getAlloyConfig();
  outputChannel.appendLine(`[Alloy] Ready. Provider: ${config.provider}, model: ${config.model}. Run "Alloy: Setup" to change it.`);
}

function createHeadProvider() {
  return new (class implements vscode.TextDocumentContentProvider {
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
}

function registerCommands(
  context: vscode.ExtensionContext,
  statusBarItem: vscode.StatusBarItem,
  headProvider: ReturnType<typeof createHeadProvider>,
) {
  const openMenu = vscode.commands.registerCommand('alloy.openMenu', async () => {
    const picked = await vscode.window.showQuickPick(
      [
        {
          label: '$(gear) Setup',
          description: 'Choose provider, model, and credentials',
          command: 'alloy.setup',
        },
        {
          label: '$(search) Review Current File',
          description: 'Review uncommitted changes in the active file',
          command: 'alloy.reviewCurrentFile',
        },
        {
          label: '$(diff-multiple) Review All Changed Files',
          description: 'Review supported changed files in this workspace',
          command: 'alloy.reviewAllChangedFiles',
        },
        {
          label: '$(comment-discussion) Show Comments',
          description: 'Open the Comments view for Alloy review threads',
          command: 'workbench.panel.comments.view.focus',
        },
        {
          label: '$(list-tree) Show Findings',
          description: 'Focus the Alloy Findings view',
          command: 'alloyFindings.focus',
        },
        {
          label: '$(clear-all) Clear Findings',
          description: 'Clear diagnostics, comments, findings, and review cache',
          command: 'alloy.clearFindings',
        },
      ],
      { placeHolder: 'Alloy actions' },
    );
    if (picked) {
      await vscode.commands.executeCommand(picked.command);
    }
  });

  const setup = vscode.commands.registerCommand('alloy.setup', async () => {
    const provider = await chooseProvider();
    if (!provider) return;

    try {
      const result = await setupProvider(context, provider);
      await vscode.workspace.getConfiguration('alloy').update('provider', result.provider, vscode.ConfigurationTarget.Global);
      await vscode.workspace.getConfiguration('alloy').update('model', result.model || providerDefaultModel(result.provider), vscode.ConfigurationTarget.Global);
      await validateProvider(result.provider, {
        apiKey: result.apiKey,
        baseUrl: result.baseUrl,
        model: result.model,
      });
      vscode.window.showInformationMessage(`Alloy: ${providerLabel(result.provider)} is configured.`);
    } catch (err) {
      vscode.window.showErrorMessage(`Alloy setup failed: ${(err as Error).message}`);
    }
  });

  const showIssue = vscode.commands.registerCommand('alloy.showIssue', (message: string, suggestion: string, rationale?: string) => {
    const detail = [message, suggestion ? `Suggestion: ${suggestion}` : '', rationale ? `Why: ${rationale}` : '']
      .filter(Boolean)
      .join('\n\n');
    vscode.window.showInformationMessage(`[Alloy] ${detail}`, 'Copy').then((action) => {
      if (action === 'Copy') vscode.env.clipboard.writeText(detail);
    });
  });

  const copySuggestion = vscode.commands.registerCommand('alloy.copySuggestion', async (suggestion: string) => {
    await vscode.env.clipboard.writeText(suggestion ?? '');
    vscode.window.showInformationMessage('Alloy: Suggestion copied.');
  });

  const reviewCurrent = vscode.commands.registerCommand('alloy.reviewCurrentFile', async (args?: { autoTrigger?: boolean }) => {
    await reviewActiveEditor(context, statusBarItem, headProvider, args?.autoTrigger === true);
  });

  const legacyReviewCurrent = vscode.commands.registerCommand('reviewbot.reviewCurrentFile', async (args?: { autoTrigger?: boolean }) => {
    await reviewActiveEditor(context, statusBarItem, headProvider, args?.autoTrigger === true);
  });

  const reviewAll = vscode.commands.registerCommand('alloy.reviewAllChangedFiles', async () => {
    await reviewAllChangedFiles(context, statusBarItem);
  });

  const clear = vscode.commands.registerCommand('alloy.clearFindings', () => {
    diagnosticCollection.clear();
    findingsTree.clear();
    clearReviewCache();
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      commentController.clearComments(editor.document.uri);
      clearFindings(editor.document.uri);
    }
    vscode.window.showInformationMessage('Alloy: Findings cleared.');
  });

  context.subscriptions.push(openMenu, setup, showIssue, copySuggestion, reviewCurrent, legacyReviewCurrent, reviewAll, clear);
}

function registerAutoReview(context: vscode.ExtensionContext) {
  let debounceTimer: NodeJS.Timeout | undefined;
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc: vscode.TextDocument) => {
    if (doc.uri.scheme !== 'file') return;
    if (!vscode.workspace.getWorkspaceFolder(doc.uri)) return;
    const config = getAlloyConfig();
    if (!vscode.workspace.getConfiguration('alloy').get<boolean>('reviewOnSave', true)) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      vscode.commands.executeCommand('alloy.reviewCurrentFile', { autoTrigger: true });
    }, config.debounceMs);
  }));
}

async function reviewActiveEditor(
  context: vscode.ExtensionContext,
  statusBarItem: vscode.StatusBarItem,
  headProvider: ReturnType<typeof createHeadProvider>,
  isAutoTrigger: boolean,
) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    if (!isAutoTrigger) vscode.window.showWarningMessage('No active editor to review.');
    return;
  }
  await reviewDocument(context, editor.document, statusBarItem, headProvider, isAutoTrigger, true);
}

async function reviewAllChangedFiles(context: vscode.ExtensionContext, statusBarItem: vscode.StatusBarItem) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('Alloy: Open a workspace folder before reviewing changed files.');
    return;
  }
  const config = getAlloyConfig();
  const files = (await getChangedFiles({ repoPath: workspaceFolder.uri.fsPath }))
    .filter((filePath) => isSupportedSourceFile(filePath))
    .filter((filePath) => !shouldSkipPath(filePath, workspaceFolder.uri.fsPath, config.skipPaths))
    .slice(0, config.maxFilesPerReview);

  if (files.length === 0) {
    vscode.window.showInformationMessage('Alloy: No supported changed files to review.');
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Alloy: Reviewing ${files.length} changed file(s)...`,
      cancellable: true,
    },
    async (progress, token) => {
      for (let i = 0; i < files.length; i++) {
        if (token.isCancellationRequested) break;
        progress.report({ message: path.basename(files[i]), increment: 100 / files.length });
        const doc = await vscode.workspace.openTextDocument(files[i]);
        await reviewDocument(context, doc, statusBarItem, undefined, false, false, token);
      }
    },
  );
}

async function reviewDocument(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  statusBarItem: vscode.StatusBarItem,
  headProvider?: ReturnType<typeof createHeadProvider>,
  isAutoTrigger = false,
  showDiff = false,
  token?: vscode.CancellationToken,
) {
  if (document.uri.scheme !== 'file') {
    if (!isAutoTrigger) vscode.window.showWarningMessage('Cannot review unsaved or non-file documents.');
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) {
    if (!isAutoTrigger) vscode.window.showWarningMessage('File is not in a workspace folder.');
    return;
  }

  const config = getAlloyConfig();
  const filePath = document.uri.fsPath;
  const repoPath = workspaceFolder.uri.fsPath;

  if (!isSupportedSourceFile(filePath)) {
    if (!isAutoTrigger) vscode.window.showInformationMessage('Alloy: MVP deep review supports TypeScript and JavaScript files.');
    return;
  }
  if (shouldSkipPath(filePath, repoPath, config.skipPaths)) {
    if (!isAutoTrigger) vscode.window.showInformationMessage('Alloy: File skipped by .alloyignore or alloy.skipPaths.');
    return;
  }

  await ensureProviderReady(context, config.provider);

  if (isAutoTrigger) {
    statusBarItem.text = '$(sync~spin) Alloy Reviewing...';
    statusBarItem.show();
  }

  await vscode.window.withProgress(
    {
      location: isAutoTrigger ? vscode.ProgressLocation.Window : vscode.ProgressLocation.Notification,
      title: 'Alloy: Reviewing code...',
      cancellable: true,
    },
    async () => {
      try {
        if (token?.isCancellationRequested) return;
        if (!isAutoTrigger) outputChannel.clear();
        headProvider?.clearCache();
        outputChannel.appendLine(`[Alloy] Reviewing: ${filePath}`);
        outputChannel.appendLine(`[Alloy] Provider: ${config.provider}, model: ${config.model}, mode: ${config.reviewMode}`);

        const rawDiff = await getDiffForFile(filePath, { repoPath });
        const diffLines = rawDiff.split(/\r?\n/).length;
        if (!rawDiff) {
          clearDocumentFindings(document.uri);
          outputChannel.appendLine(`[Alloy] No diff found for ${filePath}`);
          if (!isAutoTrigger) vscode.window.showWarningMessage('Alloy: No diff found. Make sure the file has uncommitted changes.');
          return;
        }
        if (diffLines > config.maxDiffLines) {
          outputChannel.appendLine(`[Alloy] Skipped: diff has ${diffLines} lines, max is ${config.maxDiffLines}.`);
          if (!isAutoTrigger) vscode.window.showWarningMessage(`Alloy: Diff too large (${diffLines} lines). Adjust alloy.maxDiffLines to review it.`);
          return;
        }

        const parsedDiff = parseUnifiedDiff(rawDiff, filePath);
        outputChannel.appendLine(`Summary: ${parsedDiff.addedLines.length} additions, ${parsedDiff.removedLines.length} deletions`);

        if (showDiff && headProvider) {
          await openHeadDiff(filePath, repoPath, document, headProvider);
        }

        const modifiedLines = parsedDiff.addedLines.map((line) => line.lineNumber);
        await reviewDiff({
          diff: rawDiff,
          enumeratedDiff: buildEnumeratedDiff(parsedDiff),
          sourceCode: document.getText(),
          filePath,
          modifiedLines,
          config,
          uri: document.uri,
          diagnosticCollection,
          commentController,
        });

        const diagnostics = diagnosticCollection.get(document.uri) ?? [];
        const storedFindings = getFindings(document.uri);
        const fallbackFindings = diagnostics.map((diagnostic): ReviewFinding => ({
          line: diagnostic.range.start.line + 1,
          severity: diagnostic.severity === vscode.DiagnosticSeverity.Error ? 'error' : diagnostic.severity === vscode.DiagnosticSeverity.Information ? 'info' : 'warning',
          message: diagnostic.message,
          suggestion: diagnostic.message,
        }));
        const findings = storedFindings.length > 0 ? storedFindings : fallbackFindings;
        findingsTree.setFindings(document.uri, findings);
        outputChannel.appendLine(`[Alloy] Review complete: ${diagnostics.length} finding(s)`);
        if (!isAutoTrigger) {
          vscode.window.showInformationMessage(diagnostics.length > 0
            ? `Alloy: ${diagnostics.length} issue(s) found.`
            : 'Alloy: No issues found.');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        outputChannel.appendLine(`[Alloy] Error: ${message}`);
        if (!isAutoTrigger) vscode.window.showErrorMessage(`Alloy review failed: ${message}`);
      } finally {
        statusBarItem.hide();
      }
    },
  );
}

async function openHeadDiff(
  filePath: string,
  repoPath: string,
  document: vscode.TextDocument,
  headProvider: ReturnType<typeof createHeadProvider>,
) {
  try {
    const headContent = await getHeadContent(filePath, { repoPath });
    if (headContent !== null) {
      headProvider.setHead(filePath, headContent);
      const headUri = vscode.Uri.parse(`${HEAD_SCHEME}:${filePath}`);
      vscode.commands.executeCommand('vscode.diff', headUri, document.uri, `Alloy: ${path.basename(filePath)} (HEAD -> Working)`);
    }
  } catch (err) {
    outputChannel.appendLine(`[Alloy] Could not show diff view: ${(err as Error).message}`);
  }
}

function clearDocumentFindings(uri: vscode.Uri): void {
  diagnosticCollection.set(uri, []);
  commentController.clearComments(uri);
  clearFindings(uri);
  findingsTree.clear(uri);
}

async function chooseProvider(): Promise<LLMProviderId | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'Groq', provider: 'groq' as const },
      { label: 'Gemini', provider: 'gemini' as const },
      { label: 'OpenAI-compatible', provider: 'openaiCompatible' as const },
      { label: 'Ollama', provider: 'ollama' as const },
    ],
    { placeHolder: 'Choose the model provider Alloy should use' },
  );
  return picked?.provider;
}

function providerLabel(provider: LLMProviderId): string {
  switch (provider) {
    case 'openaiCompatible':
      return 'OpenAI-compatible provider';
    case 'ollama':
      return 'Ollama';
    case 'gemini':
      return 'Gemini';
    case 'groq':
      return 'Groq';
  }
}

export function deactivate() {
  outputChannel?.dispose();
  commentController?.dispose();
}
