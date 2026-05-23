import * as vscode from 'vscode';
import { buildDiagnostics } from './diagnosticBuilder';
import { getFunctionContext, formatFunctionContext } from './astContext';
import { ReviewState } from './types';
import { runReviewGraph } from './reviewGraph';

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

  const initialState: ReviewState = {
    diff,
    sourceCode,
    filePath,
    modifiedLines,
    functionContext: functionContextStr,
    securityFindings: [],
    logicFindings: [],
    styleFindings: [],
    finalFindings: [],
  };

  const { finalFindings } = await runReviewGraph(initialState);
  const diagnostics = buildDiagnostics(finalFindings);
  diagnosticCollection.set(uri, diagnostics);
}
