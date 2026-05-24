import * as vscode from 'vscode';
import { buildDiagnostics } from './diagnosticBuilder';
import { getFunctionContext, formatFunctionContext } from './astContext';
import { ReviewState } from './types';
import { runReviewGraph } from './reviewGraph';
import { RepoStyleIndexer } from './repoStyleIndexer';
import { storeFindings } from './findingsStore';
import { AlloyCommentController } from './commentController';


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
  uri: vscode.Uri;
  diagnosticCollection: vscode.DiagnosticCollection;
  commentController?: AlloyCommentController;
}

export async function reviewDiff(options: ReviewDiffOptions): Promise<void> {
  const { diff, enumeratedDiff, sourceCode, filePath, modifiedLines, uri, diagnosticCollection, commentController } = options;

  if (!diff.trim()) {
    diagnosticCollection.set(uri, []);
    commentController?.clearComments(uri);
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

  const initialState: ReviewState = {
    diff,
    enumeratedDiff,
    filePath,
    modifiedLines,
    functionContext: functionContextStr,
    similarFunctions,
    singleAgent: true,
    securityFindings: [],
    logicFindings: [],
    styleFindings: [],
    performanceFindings: [],
    testFindings: [],
    finalFindings: [],
  };

  const { finalFindings } = await runReviewGraph(initialState);
  const diagnostics = buildDiagnostics(finalFindings);
  storeFindings(uri, finalFindings);
  diagnosticCollection.set(uri, diagnostics);
  commentController?.setComments(uri, finalFindings);
  console.log(`[Alloy] Review complete: ${finalFindings.length} findings, ${diagnostics.length} diagnostics`);
}
