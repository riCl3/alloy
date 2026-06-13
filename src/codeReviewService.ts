import * as vscode from 'vscode';
import { buildDiagnostics } from './diagnosticBuilder';
import { getFunctionContext, formatFunctionContext } from './astContext';
import { ReviewState } from './types';
import { runReviewGraph } from './reviewGraph';
import { RepoStyleIndexer } from './repoStyleIndexer';
import { storeFindings } from './findingsStore';
import { AlloyCommentController } from './commentController';
import { AlloyRuntimeConfig } from './types';
import { buildReviewCacheKey, getCachedReview, setCachedReview } from './reviewCache';
import { redactSensitiveText } from './redaction';
import * as fs from 'fs';
import * as path from 'path';
import { loadCustomRules, buildCustomRulesPrompt, applyPatternRules } from './customRules';


let indexer: RepoStyleIndexer | null = null;

export function initIndexer(workspacePath: string, cachePath?: string): Promise<void> {
  indexer = new RepoStyleIndexer();
  return indexer.initialize(workspacePath, cachePath);
}

export interface ReviewDiffOptions {
  diff: string;
  enumeratedDiff: string;
  sourceCode: string;
  filePath: string;
  modifiedLines: number[];
  config?: AlloyRuntimeConfig;
  uri: vscode.Uri;
  diagnosticCollection: vscode.DiagnosticCollection;
  commentController?: AlloyCommentController;
}

export async function reviewDiff(options: ReviewDiffOptions): Promise<void> {
  const { diff, enumeratedDiff, sourceCode, filePath, modifiedLines, uri, diagnosticCollection, commentController, config } = options;

  if (!diff.trim()) {
    diagnosticCollection.set(uri, []);
    commentController?.clearComments(uri);
    return;
  }

  const reviewMode = config?.reviewMode ?? 'fast';
  const model = config?.model ?? '';
  const cacheKey = config ? buildReviewCacheKey(filePath, diff, model, reviewMode) : '';
  const cached = config ? getCachedReview(filePath, cacheKey) : undefined;
  if (cached) {
    const diagnostics = buildDiagnostics(cached);
    storeFindings(uri, cached);
    diagnosticCollection.set(uri, diagnostics);
    commentController?.setComments(uri, cached);
    console.log(`[Alloy] Review cache hit: ${cached.length} finding(s)`);
    return;
  }

  console.log(`[Alloy] Extracting function context...`);
  const functionContexts = await getFunctionContext(sourceCode, modifiedLines, filePath);
  const functionContextStr = formatFunctionContext(functionContexts);
  console.log(`[Alloy] Function context: ${functionContexts.length} functions found`);

  let similarFunctions = '';
  if (indexer && indexer.vectorStore.size > 0) {
    try {
      console.log(`[Alloy] Querying similar functions...`);
      similarFunctions = await indexer.querySimilar(sourceCode, modifiedLines, filePath, 3);
      console.log(`[Alloy] Similar functions found: ${similarFunctions.length} chars`);
    } catch (err) {
      console.warn(`[Alloy] Similar function query failed: ${(err as Error).message}`);
    }
  }

  const packageContext = await readPackageContext(filePath);
  const redactedDiff = redactSensitiveText(diff);
  const redactedEnumeratedDiff = redactSensitiveText(enumeratedDiff);
  const redactedFunctionContext = redactSensitiveText(functionContextStr);
  const redactedSimilarFunctions = redactSensitiveText(similarFunctions);

  const initialState: ReviewState = {
    diff: redactedDiff,
    enumeratedDiff: redactedEnumeratedDiff,
    filePath,
    modifiedLines,
    functionContext: redactedFunctionContext,
    similarFunctions: redactedSimilarFunctions,
    packageContext,
    reviewMode,
    singleAgent: reviewMode !== 'deep',
    securityFindings: [],
    logicFindings: [],
    styleFindings: [],
    performanceFindings: [],
    testFindings: [],
    finalFindings: [],
  };

  // Load and apply custom rules
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  const customRules = workspaceFolder ? loadCustomRules(workspaceFolder.uri.fsPath) : [];
  const customRulesPrompt = buildCustomRulesPrompt(customRules);
  if (customRulesPrompt) {
    initialState.functionContext += customRulesPrompt;
  }
  const patternFindings = customRules.length > 0 ? applyPatternRules(customRules, diff) : [];

  const { finalFindings } = await runReviewGraph(initialState);
  const allFindings = [...finalFindings, ...patternFindings];
  const filteredFindings = filterFindings(allFindings, config);
  if (config) setCachedReview(filePath, cacheKey, filteredFindings);
  const diagnostics = buildDiagnostics(filteredFindings);
  storeFindings(uri, filteredFindings);
  diagnosticCollection.set(uri, diagnostics);
  commentController?.setComments(uri, filteredFindings);
  console.log(`[Alloy] Review complete: ${filteredFindings.length} findings, ${diagnostics.length} diagnostics`);
}

function filterFindings(findings: ReviewState['finalFindings'], config?: AlloyRuntimeConfig) {
  if (!config) return findings;
  const categories = new Set(config.enabledCategories);
  const severities = new Set(config.enabledSeverities);
  return findings.filter((finding) => {
    const categoryOk = !finding.category || categories.has(finding.category);
    return categoryOk && severities.has(finding.severity);
  });
}

async function readPackageContext(filePath: string): Promise<string> {
  let dir = path.dirname(filePath);
  while (dir && dir !== path.dirname(dir)) {
    const pkgPath = path.join(dir, 'package.json');
    try {
      const raw = await fs.promises.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      return [
        'Package context:',
        `Scripts: ${Object.keys(pkg.scripts ?? {}).join(', ') || 'none'}`,
        `Dependencies: ${Object.keys(pkg.dependencies ?? {}).slice(0, 30).join(', ') || 'none'}`,
        `Dev dependencies: ${Object.keys(pkg.devDependencies ?? {}).slice(0, 30).join(', ') || 'none'}`,
      ].join('\n');
    } catch {
      dir = path.dirname(dir);
    }
  }
  return '';
}
