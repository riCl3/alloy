import * as vscode from 'vscode';
import * as path from 'path';
import { getChangedFiles, getDiffForFile, getHeadContent, getStagedDiffForFile, getStagedFiles } from './gitUtils';
import { parseUnifiedDiff, buildEnumeratedDiff } from './diffParser';
import { reviewDiff } from './codeReviewService';
import { ensureProviderReady } from './secretManager';
import { AlloyCodeActionProvider } from './codeActionProvider';
import { AlloyCommentController } from './commentController';
import { AlloyFindingsTree } from './findingsTree';
import { getAlloyConfig } from './config';
import { ReviewFinding } from './types';
import { clearFindings, getFindings, getAllFindings, getAllFindingsMap, onDidChangeFindings } from './findingsStore';
import { clearReviewCache } from './reviewCache';
import { isSupportedSourceFile, shouldSkipPath } from './ignore';
import { SetupPanel } from './panels/SetupPanel';
import { exportFindingsJSON, exportFindingsMarkdown } from './export';
import { generatePRDescription } from './prDescriptionGenerator';
import { RateLimiter } from './rateLimiter';

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
  statusBarItem.command = 'alloyFindings.focus';
  updateStatusBar(statusBarItem);
  context.subscriptions.push(statusBarItem);
  context.subscriptions.push(onDidChangeFindings(() => updateStatusBar(statusBarItem)));

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
    await SetupPanel.createOrShow(context);
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

  const reviewAll = vscode.commands.registerCommand('alloy.reviewAllChangedFiles', async () => {
    await reviewAllChangedFiles(context, statusBarItem);
  });

  const reviewStagedCurrent = vscode.commands.registerCommand('alloy.reviewStagedCurrentFile', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Alloy: No active editor.');
      return;
    }
    const filePath = editor.document.uri.fsPath;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!workspaceFolder) {
      vscode.window.showWarningMessage('Alloy: File is not in a workspace.');
      return;
    }
    try {
      const diff = await getStagedDiffForFile(filePath, { repoPath: workspaceFolder.uri.fsPath });
      if (!diff.trim()) {
        vscode.window.showInformationMessage('Alloy: No staged changes found.');
        return;
      }
      await reviewDiffAndShowResults(editor.document, diff, context, statusBarItem);
    } catch (err) {
      vscode.window.showErrorMessage(`Alloy: Staged review failed: ${(err as Error).message}`);
    }
  });

  const reviewStagedAll = vscode.commands.registerCommand('alloy.reviewAllStagedFiles', async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showWarningMessage('Alloy: No workspace folder open.');
      return;
    }
    const repoPath = workspaceFolders[0].uri.fsPath;
    const stagedFiles = await getStagedFiles({ repoPath });
    const supportedFiles = stagedFiles.filter(f => isSupportedSourceFile(f) && !shouldSkipPath(f, repoPath));
    if (supportedFiles.length === 0) {
      vscode.window.showInformationMessage('Alloy: No staged changes found.');
      return;
    }
    vscode.window.showInformationMessage(`Alloy: Found ${supportedFiles.length} staged file(s) to review.`);
    for (const file of supportedFiles) {
      try {
        const doc = await vscode.workspace.openTextDocument(file);
        const diff = await getStagedDiffForFile(file, { repoPath });
        if (diff.trim()) {
          await reviewDiffAndShowResults(doc, diff, context, statusBarItem);
        }
      } catch (err) {
        outputChannel.appendLine(`[Alloy] Staged review failed for ${file}: ${(err as Error).message}`);
      }
    }
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

  const dismissFinding = vscode.commands.registerCommand('alloy.dismissFinding', async (uri?: vscode.Uri, findingId?: string) => {
    if (!uri || !findingId) return;
    findingsTree.dismissFinding(uri, findingId);
    const remaining = findingsTree.getAllFindings().filter(f => f.uri.toString() === uri.toString());
    diagnosticCollection.set(uri, remaining.map(f => {
      const line = f.finding.line - 1;
      return new vscode.Diagnostic(new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER), f.finding.message, vscode.DiagnosticSeverity.Warning);
    }));
  });

  const dismissAllInFile = vscode.commands.registerCommand('alloy.dismissAllInFile', async (uri?: vscode.Uri) => {
    if (!uri) return;
    findingsTree.dismissAllInFile(uri);
    diagnosticCollection.delete(uri);
    commentController.clearComments(uri);
    clearFindings(uri);
  });

  const copyFinding = vscode.commands.registerCommand('alloy.copyFinding', async (_uri?: vscode.Uri, finding?: ReviewFinding) => {
    if (!finding) return;
    const text = `[${finding.severity.toUpperCase()}] ${finding.message}\nSuggestion: ${finding.suggestion}${finding.rationale ? `\nRationale: ${finding.rationale}` : ''}`;
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage('Alloy: Finding copied.');
  });

  const groupByFile = vscode.commands.registerCommand('alloy.groupByFile', () => {
    findingsTree.setGroupBy('file');
  });

  const groupBySeverity = vscode.commands.registerCommand('alloy.groupBySeverity', () => {
    findingsTree.setGroupBy('severity');
  });

  const groupByCategory = vscode.commands.registerCommand('alloy.groupByCategory', () => {
    findingsTree.setGroupBy('category');
  });

  const filterFindings = vscode.commands.registerCommand('alloy.filterFindings', async () => {
    const config = getAlloyConfig();
    const items: vscode.QuickPickItem[] = [
      { label: '$(error) Errors', picked: config.enabledSeverities.includes('error'), description: 'Show error-severity findings' },
      { label: '$(warning) Warnings', picked: config.enabledSeverities.includes('warning'), description: 'Show warning-severity findings' },
      { label: '$(info) Info', picked: config.enabledSeverities.includes('info'), description: 'Show info-severity findings' },
      { label: '$(shield) Security', picked: config.enabledCategories.includes('security'), description: 'Security findings' },
      { label: '$(lightbulb) Logic', picked: config.enabledCategories.includes('logic'), description: 'Logic findings' },
      { label: '$(symbol-method) Quality', picked: config.enabledCategories.includes('quality'), description: 'Code quality findings' },
      { label: '$(zap) Performance', picked: config.enabledCategories.includes('performance'), description: 'Performance findings' },
      { label: '$(beaker) Test', picked: config.enabledCategories.includes('test'), description: 'Test-related findings' },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: 'Toggle severity and category filters',
    });
    if (!picked) return;

    const pickedLabels = new Set(picked.map(p => p.label));
    const severities: string[] = [];
    if (pickedLabels.has('$(error) Errors')) severities.push('error');
    if (pickedLabels.has('$(warning) Warnings')) severities.push('warning');
    if (pickedLabels.has('$(info) Info')) severities.push('info');

    const categories: string[] = [];
    if (pickedLabels.has('$(shield) Security')) categories.push('security');
    if (pickedLabels.has('$(lightbulb) Logic')) categories.push('logic');
    if (pickedLabels.has('$(symbol-method) Quality')) categories.push('quality');
    if (pickedLabels.has('$(zap) Performance')) categories.push('performance');
    if (pickedLabels.has('$(beaker) Test')) categories.push('test');

    await vscode.workspace.getConfiguration('alloy').update('enabledSeverities', severities.length > 0 ? severities : config.enabledSeverities, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('alloy').update('enabledCategories', categories.length > 0 ? categories : config.enabledCategories, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage('Alloy: Filters updated.');
  });

  const exportJSON = vscode.commands.registerCommand('alloy.exportFindingsJSON', async () => {
    const findingsMap = getAllFindingsMap();
    const json = exportFindingsJSON(findingsMap);
    const doc = await vscode.workspace.openTextDocument({ content: json, language: 'json' });
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage('Alloy: Findings exported as JSON.');
  });

  const exportMarkdown = vscode.commands.registerCommand('alloy.exportFindingsMarkdown', async () => {
    const findingsMap = getAllFindingsMap();
    const md = exportFindingsMarkdown(findingsMap);
    const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage('Alloy: Findings exported as Markdown.');
  });

  const generatePR = vscode.commands.registerCommand('alloy.generatePRDescription', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showWarningMessage('Alloy: Open a workspace folder first.');
      return;
    }
    const findings = getAllFindings();
    if (findings.length === 0) {
      vscode.window.showWarningMessage('Alloy: No findings available. Run a review first.');
      return;
    }
    const changedFiles = await getChangedFiles({ repoPath: workspaceFolder.uri.fsPath });
    try {
      vscode.window.showInformationMessage('Alloy: Generating PR description...');
      const description = await generatePRDescription(findings, changedFiles);
      const doc = await vscode.workspace.openTextDocument({ content: description, language: 'markdown' });
      await vscode.window.showTextDocument(doc);
    } catch (err) {
      vscode.window.showErrorMessage(`Alloy: PR description generation failed: ${(err as Error).message}`);
    }
  });

  const openRulesFile = vscode.commands.registerCommand('alloy.openRulesFile', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showWarningMessage('Alloy: Open a workspace folder first.');
      return;
    }
    const rulesPath = path.join(workspaceFolder.uri.fsPath, '.alloy', 'rules.json');
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(rulesPath));
    } catch {
      // File doesn't exist — create from template
      const dirPath = path.join(workspaceFolder.uri.fsPath, '.alloy');
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
      const template = JSON.stringify([{
        id: 'example-rule',
        name: 'Example Rule',
        description: 'A custom review rule',
        severity: 'warning',
        category: 'quality',
        pattern: 'console\\.log',
        enabled: false,
      }], null, 2);
      await vscode.workspace.fs.writeFile(vscode.Uri.file(rulesPath), Buffer.from(template, 'utf-8'));
    }
    const doc = await vscode.workspace.openTextDocument(rulesPath);
    await vscode.window.showTextDocument(doc);
  });

  context.subscriptions.push(openMenu, setup, showIssue, copySuggestion, reviewCurrent, reviewAll, clear, reviewStagedCurrent, reviewStagedAll, dismissFinding, dismissAllInFile, copyFinding, groupByFile, groupBySeverity, groupByCategory, filterFindings, exportJSON, exportMarkdown, generatePR, openRulesFile);
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

  const CONCURRENCY_LIMIT = 3;
  const limiter = new RateLimiter(CONCURRENCY_LIMIT);
  let completed = 0;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Alloy: Reviewing ${files.length} changed file(s)...`,
      cancellable: true,
    },
    async (progress, token) => {
      const reviewOne = async (filePath: string) => {
        if (token.isCancellationRequested) return;
        progress.report({ message: path.basename(filePath) });
        const doc = await vscode.workspace.openTextDocument(filePath);
        await reviewDocument(context, doc, statusBarItem, undefined, false, false, token);
        completed++;
        progress.report({ message: `${completed}/${files.length}` });
      };

      const workers = files.map(file => limiter.run(() => reviewOne(file)));
      await Promise.allSettled(workers);
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
        updateStatusBar(statusBarItem);
      }
    },
  );
}

async function reviewDiffAndShowResults(
  document: vscode.TextDocument,
  rawDiff: string,
  context: vscode.ExtensionContext,
  statusBarItem: vscode.StatusBarItem,
) {
  const config = getAlloyConfig();
  const filePath = document.uri.fsPath;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) return;

  await ensureProviderReady(context, config.provider);

  statusBarItem.text = '$(sync~spin) Alloy Reviewing...';
  statusBarItem.show();

  try {
    outputChannel.appendLine(`[Alloy] Reviewing staged: ${filePath}`);
    const parsedDiff = parseUnifiedDiff(rawDiff, filePath);
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
    vscode.window.showInformationMessage(diagnostics.length > 0
      ? `Alloy: ${diagnostics.length} issue(s) found.`
      : 'Alloy: No issues found.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[Alloy] Error: ${message}`);
    vscode.window.showErrorMessage(`Alloy review failed: ${message}`);
  } finally {
    updateStatusBar(statusBarItem);
  }
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

function updateStatusBar(statusBarItem: vscode.StatusBarItem): void {
  const allFindings = getAllFindings();
  const errors = allFindings.filter(f => f.severity === 'error').length;
  const warnings = allFindings.filter(f => f.severity === 'warning').length;
  const infos = allFindings.filter(f => f.severity === 'info').length;
  const total = errors + warnings + infos;

  if (total === 0) {
    statusBarItem.text = '$(check) Alloy';
    statusBarItem.backgroundColor = undefined;
  } else {
    const parts: string[] = [];
    if (errors > 0) parts.push(`${errors}E`);
    if (warnings > 0) parts.push(`${warnings}W`);
    if (infos > 0) parts.push(`${infos}I`);
    statusBarItem.text = `$(warning) Alloy: ${parts.join(' ')}`;
    statusBarItem.backgroundColor = errors > 0
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
  }
  statusBarItem.show();
}

function clearDocumentFindings(uri: vscode.Uri): void {
  diagnosticCollection.set(uri, []);
  commentController.clearComments(uri);
  clearFindings(uri);
  findingsTree.clear(uri);
}

export function deactivate() {
  outputChannel?.dispose();
  commentController?.dispose();
}
