/**
 * Decoration manager for Alloy findings.
 *
 * Creates and manages gutter decorations (severity dots) and
 * full-line highlight decorations for reviewed lines.
 */

import * as vscode from 'vscode';
import { ReviewFinding, Severity } from './types';

interface DecorationSet {
  gutter: vscode.TextEditorDecorationType;
  highlight: vscode.TextEditorDecorationType;
}

const decorations: Record<Severity, DecorationSet> = {} as Record<Severity, DecorationSet>;

const SEVERITY_CONFIG: Record<Severity, {
  gutterColor: string;
  highlightColor: string;
  glyph: string;
}> = {
  error: {
    gutterColor: 'testing.iconFailed',
    highlightColor: 'editorError.background',
    glyph: '●',
  },
  warning: {
    gutterColor: 'testing.iconSkipped',
    highlightColor: 'editorWarning.background',
    glyph: '●',
  },
  info: {
    gutterColor: 'testing.iconPassed',
    highlightColor: 'editorInfo.background',
    glyph: '●',
  },
};

export function initializeDecorations(): void {
  for (const severity of ['error', 'warning', 'info'] as Severity[]) {
    const config = SEVERITY_CONFIG[severity];

    const gutter = vscode.window.createTextEditorDecorationType({
      isWholeLine: false,
      before: {
        contentText: config.glyph,
        color: new vscode.ThemeColor(config.gutterColor),
        fontWeight: 'bold',
        fontStyle: 'normal',
        margin: '0 6px 0 2px',
        width: '12px',
        height: '12px',
      },
    });

    const highlight = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor(config.highlightColor),
      overviewRulerColor: new vscode.ThemeColor(config.gutterColor),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      borderColor: new vscode.ThemeColor(config.gutterColor),
    });

    decorations[severity] = { gutter, highlight };
  }
}

export function applyDecorations(editor: vscode.TextEditor, findings: ReviewFinding[]): void {
  const bySeverity: Record<Severity, vscode.Range[]> = {
    error: [],
    warning: [],
    info: [],
  };

  for (const f of findings) {
    const line = Math.max(0, f.line - 1);
    const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
    bySeverity[f.severity].push(range);
  }

  for (const severity of ['error', 'warning', 'info'] as Severity[]) {
    editor.setDecorations(decorations[severity].gutter, bySeverity[severity]);
    editor.setDecorations(decorations[severity].highlight, bySeverity[severity]);
  }
}

export function clearDecorations(editor: vscode.TextEditor): void {
  for (const severity of ['error', 'warning', 'info'] as Severity[]) {
    editor.setDecorations(decorations[severity].gutter, []);
    editor.setDecorations(decorations[severity].highlight, []);
  }
}

export function disposeDecorations(): void {
  for (const severity of ['error', 'warning', 'info'] as Severity[]) {
    decorations[severity]?.gutter.dispose();
    decorations[severity]?.highlight.dispose();
  }
}
