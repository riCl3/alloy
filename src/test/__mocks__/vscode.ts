export const Diagnostic = jest
  .fn()
  .mockImplementation(
    (
      range: { start: { line: number } },
      message: string,
      severity: number,
    ) => ({
      range,
      message,
      severity,
      source: undefined,
      code: undefined as any,
    }),
  );

export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
};

export const Range = jest
  .fn()
  .mockImplementation(
    (
      startLine: number,
      startChar: number,
      endLine: number,
      endChar: number,
    ) => ({
      start: { line: startLine, character: startChar },
      end: { line: endLine, character: endChar },
    }),
  );

export const Position = jest
  .fn()
  .mockImplementation((line: number, character: number) => ({
    line,
    character,
  }));

export const Uri = {
  file: (path: string) => ({
    fsPath: path,
    scheme: 'file',
    path,
    toString: () => `file:${path}`,
  }),
  parse: (s: string) => {
    const match = s.match(/^([^:]+):(.+)/);
    if (match) {
      return {
        fsPath: match[2],
        scheme: match[1],
        path: match[2],
        toString: () => s,
      };
    }
    return {
      fsPath: s,
      scheme: 'file',
      path: s,
      toString: () => `file:${s}`,
    };
  },
};

export const CodeActionKind = {
  QuickFix: { value: 'quickfix' },
};

export const languages = {
  createDiagnosticCollection: jest.fn().mockReturnValue({
    set: jest.fn(),
    clear: jest.fn(),
    dispose: jest.fn(),
    delete: jest.fn(),
    has: jest.fn(),
    get: jest.fn(),
    forEach: jest.fn(),
    name: 'alloy',
  }),
  registerCodeActionsProvider: jest.fn(),
};

export const workspace = {
  getWorkspaceFolder: jest.fn(),
  textDocuments: [],
  registerTextDocumentContentProvider: jest.fn(),
};

export enum ExtensionMode {
  Test = 1,
}

export enum ProgressLocation {
  Notification = 15,
}

export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
}

export const window = {
  createOutputChannel: jest.fn().mockReturnValue({
    appendLine: jest.fn(),
    append: jest.fn(),
    clear: jest.fn(),
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
  }),
  showErrorMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showInformationMessage: jest.fn(),
  showInputBox: jest.fn(),
  activeTextEditor: undefined,
  withProgress: jest.fn(),
  createWebviewPanel: jest.fn().mockReturnValue({
    webview: { html: '' },
    dispose: jest.fn(),
  }),
};

export const commands = {
  registerCommand: jest.fn(),
  executeCommand: jest.fn(),
};

export class CodeAction {
  title: string;
  kind: any;
  diagnostics: any[] = [];
  edit: any;
  command: any;
  isPreferred: boolean = false;
  constructor(title: string, kind?: any) {
    this.title = title;
    this.kind = kind;
  }
}

export class WorkspaceEdit {
  insert = jest.fn();
  replace = jest.fn();
  delete = jest.fn();
}
