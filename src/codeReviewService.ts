import * as vscode from 'vscode';
import { buildDiagnostics } from './diagnosticBuilder';
import { getFunctionContext, formatFunctionContext } from './astContext';
import { ReviewState } from './types';
import { runReviewGraph } from './reviewGraph';
import { RepoStyleIndexer } from './repoStyleIndexer';

let indexer: RepoStyleIndexer | null = null;

export function initIndexer(workspacePath: string): Promise<void> {
  indexer = new RepoStyleIndexer();
  return indexer.initialize(workspacePath);
}

export function getIndexer(): RepoStyleIndexer | null {
  return indexer;
}

export interface ReviewDiffOptions {
  diff: string;
  sourceCode: string;
  filePath: string;
  modifiedLines: number[];
  uri: vscode.Uri;
  diagnosticCollection: vscode.DiagnosticCollection;
}

export async function reviewDiff(options: ReviewDiffOptions): Promise<void> {
  const { diff, sourceCode, filePath, modifiedLines, uri, diagnosticCollection } = options;

  if (!diff.trim()) {
    diagnosticCollection.set(uri, []);
    return;
  }

  const functionContexts = await getFunctionContext(sourceCode, modifiedLines, filePath);
  const functionContextStr = formatFunctionContext(functionContexts);

  let similarFunctions = '';
  if (indexer && indexer.vectorStore.size > 0) {
    try {
      similarFunctions = await indexer.querySimilar(sourceCode, modifiedLines, filePath, 3);
    } catch {
      // fail silently if similarity query fails
    }
  }

  const initialState: ReviewState = {
    diff,
    sourceCode,
    filePath,
    modifiedLines,
    functionContext: functionContextStr,
    similarFunctions,
    securityFindings: [],
    logicFindings: [],
    styleFindings: [],
    finalFindings: [],
  };

  const { finalFindings } = await runReviewGraph(initialState);
  const diagnostics = buildDiagnostics(finalFindings);
  diagnosticCollection.set(uri, diagnostics);
}
