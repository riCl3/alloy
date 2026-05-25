import * as vscode from 'vscode';
import { AlloyCodeActionProvider, canApplyFinding } from '../codeActionProvider';
import { ReviewFinding } from '../types';
import { getFindings } from '../findingsStore';

jest.mock('../findingsStore', () => ({
  getFindings: jest.fn(),
}));

const mockGetFindings = getFindings as jest.Mock;

function makeDocument(lines: string[]): vscode.TextDocument {
  return {
    uri: vscode.Uri.file('/repo/src/file.ts'),
    languageId: 'typescript',
    lineCount: lines.length,
    lineAt: jest.fn((line: number) => ({ text: lines[line] })),
  } as unknown as vscode.TextDocument;
}

function makeDiagnostic(line: number): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
    'Unsafe value',
    vscode.DiagnosticSeverity.Warning,
  );
  diagnostic.source = 'Alloy';
  return diagnostic;
}

describe('AlloyCodeActionProvider', () => {
  beforeEach(() => {
    mockGetFindings.mockReset();
  });

  it('offers apply fix only for high-confidence valid replacements', () => {
    const finding: ReviewFinding = {
      line: 1,
      severity: 'warning',
      message: 'Unsafe value',
      suggestion: 'Use a guard',
      confidence: 'high',
      range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 5 },
      replacement: 'const safe = value;',
    };
    mockGetFindings.mockReturnValue([finding]);

    const provider = new AlloyCodeActionProvider();
    const actions = provider.provideCodeActions(
      makeDocument(['value']),
      new vscode.Range(0, 0, 0, 1),
      { diagnostics: [makeDiagnostic(0)] } as unknown as vscode.CodeActionContext,
    );

    expect(actions.map((action) => action.title)).toContain('Alloy: Apply fix on line 1');
    const apply = actions.find((action) => action.title === 'Alloy: Apply fix on line 1')!;
    expect(apply.isPreferred).toBe(true);
    expect(apply.edit!.replace).toHaveBeenCalled();
  });

  it('rejects low-confidence replacements', () => {
    const finding: ReviewFinding = {
      line: 1,
      severity: 'warning',
      message: 'Unsafe value',
      suggestion: 'Use a guard',
      confidence: 'low',
      range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 5 },
      replacement: 'const safe = value;',
    };

    expect(canApplyFinding(finding, makeDocument(['value']))).toBe(false);
  });
});
