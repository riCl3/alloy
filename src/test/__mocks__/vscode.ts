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
  file: (path: string) => ({ fsPath: path, scheme: 'file', path }),
  parse: (s: string) => ({ fsPath: s, scheme: 'file', path: s }),
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
};

export const workspace = {
  getWorkspaceFolder: jest.fn(),
  textDocuments: [],
};

export enum ExtensionMode {
  Test = 1,
}

export enum ProgressLocation {
  Notification = 15,
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
};

export const commands = {
  registerCommand: jest.fn(),
};
