import * as vscode from 'vscode';
import { ReviewFinding } from './types';

const SEVERITY_MAP: Record<string, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

export function buildDiagnostics(findings: ReviewFinding[]): vscode.Diagnostic[] {
  return findings.map((f) => {
    const line = Math.max(0, f.line - 1);
    const range = new vscode.Range(line, 0, line, 0);
    const severity = SEVERITY_MAP[f.severity] ?? vscode.DiagnosticSeverity.Warning;

    const diagnostic = new vscode.Diagnostic(range, f.message, severity);
    diagnostic.source = 'Alloy';
    diagnostic.code = `alloy-${f.severity}`;

    return diagnostic;
  });
}
