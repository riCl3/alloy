import * as vscode from 'vscode';
import { sendToOllama, buildReviewPrompt, OllamaOptions } from './ollamaClient';
import { buildDiagnostics } from './diagnosticBuilder';
import { getFunctionContext, formatFunctionContext } from './astContext';
import { ReviewFinding } from './types';

export interface ReviewDiffOptions {
  diff: string;
  sourceCode: string;
  filePath: string;
  modifiedLines: number[];
  uri: vscode.Uri;
  diagnosticCollection: vscode.DiagnosticCollection;
  ollamaOptions?: OllamaOptions;
}

export async function reviewDiff(options: ReviewDiffOptions): Promise<void> {
  const {
    diff,
    sourceCode,
    filePath,
    modifiedLines,
    uri,
    diagnosticCollection,
    ollamaOptions,
  } = options;

  if (!diff.trim()) {
    diagnosticCollection.set(uri, []);
    return;
  }

  const functionContexts = await getFunctionContext(
    sourceCode,
    modifiedLines,
    filePath,
  );
  const functionContextStr = formatFunctionContext(functionContexts);

  const prompt = buildReviewPrompt(diff, functionContextStr);
  const responseText = await sendToOllama(prompt, ollamaOptions);

  let findings: ReviewFinding[];
  try {
    const parsed = JSON.parse(responseText);
    if (!Array.isArray(parsed)) {
      throw new Error('LLM response is not a JSON array');
    }
    findings = parsed as ReviewFinding[];
  } catch (err) {
    throw new Error(
      `Failed to parse LLM response: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const diagnostics = buildDiagnostics(findings);
  diagnosticCollection.set(uri, diagnostics);
}
