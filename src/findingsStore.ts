import * as vscode from 'vscode';
import { ReviewFinding } from './types';

// Stores findings per document URI, keyed by diagnostic range
const store = new Map<string, ReviewFinding[]>();

const onDidChangeFindingsEmitter = new vscode.EventEmitter<void>();
export const onDidChangeFindings = onDidChangeFindingsEmitter.event;

export function storeFindings(uri: vscode.Uri, findings: ReviewFinding[]): void {
  store.set(uri.toString(), findings);
  onDidChangeFindingsEmitter.fire();
}

export function getFindings(uri: vscode.Uri): ReviewFinding[] {
  return store.get(uri.toString()) ?? [];
}

export function getAllFindings(): ReviewFinding[] {
  const all: ReviewFinding[] = [];
  for (const findings of store.values()) {
    all.push(...findings);
  }
  return all;
}

export function getAllFindingsMap(): Map<string, ReviewFinding[]> {
  return new Map(store);
}

export function clearFindings(uri: vscode.Uri): void {
  store.delete(uri.toString());
  onDidChangeFindingsEmitter.fire();
}
