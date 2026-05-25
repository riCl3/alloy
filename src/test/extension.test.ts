import * as vscode from 'vscode';

const mockReviewDiff = jest.fn();
const mockInitIndexer = jest.fn().mockResolvedValue(undefined);
const mockEnsureProviderReady = jest.fn().mockResolvedValue({ apiKey: 'gk', baseUrl: '' });
const mockGetDiffForFile = jest.fn();
const mockParseUnifiedDiff = jest.fn();
const mockBuildEnumeratedDiff = jest.fn().mockReturnValue('[Line 2] new line  <-- MODIFIED');

jest.mock('../codeReviewService', () => ({
  reviewDiff: mockReviewDiff,
  initIndexer: mockInitIndexer,
}));

jest.mock('../secretManager', () => ({
  ensureProviderReady: mockEnsureProviderReady,
  setupProvider: jest.fn(),
}));

jest.mock('../llmRouter', () => ({
  validateProvider: jest.fn(),
}));

jest.mock('../gitUtils', () => ({
  getDiffForFile: mockGetDiffForFile,
  getHeadContent: jest.fn().mockResolvedValue(null),
}));

jest.mock('../diffParser', () => ({
  parseUnifiedDiff: mockParseUnifiedDiff,
  buildEnumeratedDiff: mockBuildEnumeratedDiff,
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

  it('registers the alloy.reviewCurrentFile command and legacy alias', async () => {
    const { activate } = await import('../extension');
    activate(mockContext);

    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'alloy.reviewCurrentFile',
      expect.any(Function),
    );
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'reviewbot.reviewCurrentFile',
      expect.any(Function),
    );
  });

  it('shows warning when no active editor', async () => {
    const { activate } = await import('../extension');
    activate(mockContext);

    const handler = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
      (c) => c[0] === 'alloy.reviewCurrentFile',
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
      (c) => c[0] === 'alloy.reviewCurrentFile',
    )![1];
    await handler();

    expect(mockGetDiffForFile).toHaveBeenCalledWith('/repo/src/test.ts', {
      repoPath: '/repo',
    });
    expect(mockReviewDiff).toHaveBeenCalledWith({
      diff: 'mock-diff-content',
      enumeratedDiff: '[Line 2] new line  <-- MODIFIED',
      sourceCode: 'line1\nline2\nline3',
      filePath: '/repo/src/test.ts',
      modifiedLines: [2],
      uri: doc.uri,
      diagnosticCollection: expect.any(Object),
      commentController: expect.any(Object),
      config: expect.any(Object),
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
      (c) => c[0] === 'alloy.reviewCurrentFile',
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
      (c) => c[0] === 'alloy.reviewCurrentFile',
    )![1];
    await handler();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Alloy review failed: API error',
    );
  });

  describe('auto-review on save', () => {
    let saveListener: (doc: any) => void;

    beforeEach(async () => {
      const doc = makeDocument('/repo/src/test.ts', 'line1');
      vscode.window.activeTextEditor = makeEditor(doc);

      const workspaceFolder = { uri: { fsPath: '/repo' }, name: 'repo', index: 0 };
      (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(workspaceFolder);

      const { activate } = await import('../extension');
      activate(mockContext);

      saveListener = (vscode.workspace.onDidSaveTextDocument as jest.Mock).mock.calls[0][0];
    });

    it('does not trigger review immediately on save', () => {
      const doc = makeDocument('/repo/src/test.ts', 'line1');
      saveListener(doc);

      expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it('triggers review after 2-second debounce on save', () => {
      jest.useFakeTimers();

      const doc = makeDocument('/repo/src/test.ts', 'line1');
      saveListener(doc);

      jest.advanceTimersByTime(2000);

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'alloy.reviewCurrentFile',
        { autoTrigger: true },
      );

      jest.useRealTimers();
    });

    it('resets debounce timer on rapid successive saves', () => {
      jest.useFakeTimers();

      const doc = makeDocument('/repo/src/test.ts', 'line1');
      saveListener(doc);
      jest.advanceTimersByTime(1000);
      saveListener(doc); // save again, resets timer
      jest.advanceTimersByTime(1000);
      // Only 1 second since last save — shouldn't fire yet
      expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1000);
      // Now 2 seconds since last save
      expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    it('skips auto-review when reviewOnSave is disabled', () => {
      jest.useFakeTimers();

      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue(false),
      });

      const doc = makeDocument('/repo/src/test.ts', 'line1');
      saveListener(doc);

      jest.advanceTimersByTime(2000);

      expect(vscode.commands.executeCommand).not.toHaveBeenCalled();

      jest.useRealTimers();
    });
  });
});
