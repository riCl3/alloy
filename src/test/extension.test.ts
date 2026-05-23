import * as vscode from 'vscode';

const mockReviewDiff = jest.fn();
const mockInitIndexer = jest.fn().mockResolvedValue(undefined);
const mockEnsureApiKeys = jest.fn().mockResolvedValue({ groq: 'gk', gemini: 'gk2' });
const mockGetDiffForFile = jest.fn();
const mockParseUnifiedDiff = jest.fn();

jest.mock('../codeReviewService', () => ({
  reviewDiff: mockReviewDiff,
  initIndexer: mockInitIndexer,
}));

jest.mock('../secretManager', () => ({
  ensureApiKeys: mockEnsureApiKeys,
}));

jest.mock('../gitUtils', () => ({
  getDiffForFile: mockGetDiffForFile,
  getHeadContent: jest.fn().mockResolvedValue(null),
}));

jest.mock('../diffParser', () => ({
  parseUnifiedDiff: mockParseUnifiedDiff,
}));

jest.mock('../findingsStore', () => ({
  storeFindings: jest.fn(),
  getFindings: jest.fn().mockReturnValue([]),
  clearFindings: jest.fn(),
}));

jest.mock('../codeActionProvider', () => {
  const providedCodeActionKinds = [{ value: 'quickfix' }];
  return {
    AlloyCodeActionProvider: class {
      static providedCodeActionKinds = providedCodeActionKinds;
    },
  };
});

const mockContext: vscode.ExtensionContext = {
  secrets: {
    get: jest.fn(),
    store: jest.fn(),
    delete: jest.fn(),
    onDidChange: jest.fn(),
  },
  subscriptions: [],
} as unknown as vscode.ExtensionContext;

function makeDocument(
  path: string,
  text: string,
  langId = 'typescript',
): vscode.TextDocument {
  return {
    uri: { fsPath: path, scheme: 'file' },
    fileName: path,
    getText: () => text,
    lineCount: text.split('\n').length,
    languageId: langId,
    isClosed: false,
    isDirty: false,
    isUntitled: false,
    version: 1,
    eol: 1,
    lineAt: jest.fn(),
    offsetAt: jest.fn(),
    positionAt: jest.fn(),
    save: jest.fn(),
    validateRange: jest.fn(),
    validatePosition: jest.fn(),
  } as unknown as vscode.TextDocument;
}

function makeEditor(doc: vscode.TextDocument): vscode.TextEditor {
  return {
    document: doc,
    selection: undefined as any,
    selections: [],
    visibleRanges: [],
    options: {} as any,
    viewColumn: undefined,
    edit: jest.fn(),
    insertSnippet: jest.fn(),
    setDecorations: jest.fn(),
    revealRange: jest.fn(),
    show: jest.fn(),
    hide: jest.fn(),
  } as unknown as vscode.TextEditor;
}

describe('extension activate', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    vscode.window.withProgress = jest.fn().mockImplementation((_opts, fn) => fn());
    vscode.window.activeTextEditor = undefined;
    (vscode.window.showWarningMessage as jest.Mock).mockReset();
  });

  it('registers the reviewbot.reviewCurrentFile command', async () => {
    const { activate } = await import('../extension');
    activate(mockContext);

    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'reviewbot.reviewCurrentFile',
      expect.any(Function),
    );
  });

  it('shows warning when no active editor', async () => {
    const { activate } = await import('../extension');
    activate(mockContext);

    const handler = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
      (c) => c[0] === 'reviewbot.reviewCurrentFile',
    )![1];
    await handler();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'No active editor to review.',
    );
    expect(mockReviewDiff).not.toHaveBeenCalled();
  });

  it('runs the full review pipeline for an active editor', async () => {
    const doc = makeDocument('/repo/src/test.ts', 'line1\nline2\nline3');
    vscode.window.activeTextEditor = makeEditor(doc);

    const workspaceFolder = { uri: { fsPath: '/repo' }, name: 'repo', index: 0 };
    (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(workspaceFolder);

    mockGetDiffForFile.mockResolvedValue('mock-diff-content');
    mockParseUnifiedDiff.mockReturnValue({
      addedLines: [{ lineNumber: 2, content: '+new line' }],
      removedLines: [{ lineNumber: 1, content: '-old line' }],
    });
    mockReviewDiff.mockResolvedValue(undefined);

    const { activate } = await import('../extension');
    activate(mockContext);

    const handler = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
      (c) => c[0] === 'reviewbot.reviewCurrentFile',
    )![1];
    await handler();

    expect(mockGetDiffForFile).toHaveBeenCalledWith('/repo/src/test.ts', {
      repoPath: '/repo',
    });
    expect(mockReviewDiff).toHaveBeenCalledWith({
      diff: 'mock-diff-content',
      sourceCode: 'line1\nline2\nline3',
      filePath: '/repo/src/test.ts',
      modifiedLines: [2],
      uri: doc.uri,
      diagnosticCollection: expect.any(Object),
    });
    expect(mockParseUnifiedDiff).toHaveBeenCalledWith('mock-diff-content', '/repo/src/test.ts');
  });

  it('clears diagnostics when no diff found', async () => {
    const doc = makeDocument('/repo/src/test.ts', 'line1');
    vscode.window.activeTextEditor = makeEditor(doc);

    const workspaceFolder = { uri: { fsPath: '/repo' }, name: 'repo', index: 0 };
    (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(workspaceFolder);

    mockGetDiffForFile.mockResolvedValue('');
    mockReviewDiff.mockResolvedValue(undefined);

    const { activate } = await import('../extension');
    activate(mockContext);

    const handler = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
      (c) => c[0] === 'reviewbot.reviewCurrentFile',
    )![1];
    await handler();

    expect(mockReviewDiff).not.toHaveBeenCalled();
  });

  it('shows error message when review fails', async () => {
    const doc = makeDocument('/repo/src/test.ts', 'line1');
    vscode.window.activeTextEditor = makeEditor(doc);

    const workspaceFolder = { uri: { fsPath: '/repo' }, name: 'repo', index: 0 };
    (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(workspaceFolder);

    mockGetDiffForFile.mockResolvedValue('mock-diff');
    mockParseUnifiedDiff.mockReturnValue({
      addedLines: [{ lineNumber: 1, content: '+new' }],
      removedLines: [],
    });
    mockReviewDiff.mockRejectedValue(new Error('API error'));

    const { activate } = await import('../extension');
    activate(mockContext);

    const handler = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
      (c) => c[0] === 'reviewbot.reviewCurrentFile',
    )![1];
    await handler();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Alloy review failed: API error',
    );
  });
});
