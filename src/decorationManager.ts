import * as vscode from 'vscode';
import { ReviewFinding } from './types';

const SEVERITY_DECORATIONS: Record<string, vscode.TextEditorDecorationType> = {};

function createDecoration(
  colorKey: string,
  gutterColorKey: string,
  rulerColorKey: string,
  glyphChar: string,
): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor(colorKey),
    overviewRulerColor: new vscode.ThemeColor(rulerColorKey),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    gutterIconPath: undefined, // Use before content for gutter glyph
    before: {
      contentText: glyphChar,
      color: new vscode.ThemeColor(gutterColorKey),
      fontWeight: 'bold',
      margin: '0 4px 0 0',
    },
  });
}

export function initializeDecorations(): void {
  SEVERITY_DECORATIONS.error = createDecoration(
    'editorError.background',
    'editorError.foreground',
    'editorOverviewRuler.errorForeground',
    '●',
  );
  SEVERITY_DECORATIONS.warning = createDecoration(
    'editorWarning.background',
    'editorWarning.foreground',
    'editorOverviewRuler.warningForeground',
    '●',
  );
  SEVERITY_DECORATIONS.info = createDecoration(
    'editorInfo.background',
    'editorInfo.foreground',
    'editorOverviewRuler.infoForeground',
    '●',
  );
}

export function applyDecorations(editor: vscode.TextEditor, findings: ReviewFinding[]): void {
  const errorRanges: vscode.Range[] = [];
  const warningRanges: vscode.Range[] = [];
  const infoRanges: vscode.Range[] = [];

  for (const f of findings) {
    const line = Math.max(0, f.line - 1);
    const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);

    switch (f.severity) {
      case 'error':
        errorRanges.push(range);
        break;
      case 'warning':
        warningRanges.push(range);
        break;
      case 'info':
        infoRanges.push(range);
        break;
    }
  }

  editor.setDecorations(SEVERITY_DECORATIONS.error, errorRanges);
  editor.setDecorations(SEVERITY_DECORATIONS.warning, warningRanges);
  editor.setDecorations(SEVERITY_DECORATIONS.info, infoRanges);
}

export function clearDecorations(editor: vscode.TextEditor): void {
  editor.setDecorations(SEVERITY_DECORATIONS.error, []);
  editor.setDecorations(SEVERITY_DECORATIONS.warning, []);
  editor.setDecorations(SEVERITY_DECORATIONS.info, []);
}

export function disposeDecorations(): void {
  for (const dec of Object.values(SEVERITY_DECORATIONS)) {
    dec.dispose();
  }
}
