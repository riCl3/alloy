import * as vscode from 'vscode';
import { ReviewFinding } from './types';

// Stores findings per document URI, keyed by diagnostic range
const store = new Map<string, ReviewFinding[]>();

export function storeFindings(uri: vscode.Uri, findings: ReviewFinding[]): void {
  store.set(uri.toString(), findings);
}

export function getFindings(uri: vscode.Uri): ReviewFinding[] {
  return store.get(uri.toString()) ?? [];
}

export function clearFindings(uri: vscode.Uri): void {
  store.delete(uri.toString());
}
