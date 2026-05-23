import * as vscode from 'vscode';
import { ensureApiKeys, getGroqApiKey, getGeminiApiKey, resetCache } from './secretManager';

const mockShowInputBox = vscode.window.showInputBox as jest.Mock;

function createMockSecrets(store: Record<string, string> = {}): vscode.SecretStorage {
  const secrets: Record<string, string> = { ...store };
  return {
    get: jest.fn(async (key: string) => secrets[key] ?? undefined),
    store: jest.fn(async (key: string, value: string) => { secrets[key] = value; }),
    delete: jest.fn(async (key: string) => { delete secrets[key]; }),
    onDidChange: jest.fn(),
  } as unknown as vscode.SecretStorage;
}

function createMockContext(secrets: vscode.SecretStorage): vscode.ExtensionContext {
  return {
    secrets,
    subscriptions: [],
    extensionUri: {} as any,
    extensionPath: '',
    storageUri: undefined,
    globalStorageUri: {} as any,
    logUri: {} as any,
    extensionMode: vscode.ExtensionMode.Test,
    globalState: {} as any,
    workspaceState: {} as any,
    asAbsolutePath: (p: string) => p,
    storagePath: undefined,
    globalStoragePath: '',
    logPath: '',
    extension: {} as any,
    environmentVariableCollection: {} as any,
    languageModelAccessInformation: {} as any,
  };
}

describe('ensureApiKeys', () => {
  beforeEach(() => {
    resetCache();
    mockShowInputBox.mockReset();
  });

  it('prompts for both keys when none stored', async () => {
    mockShowInputBox
      .mockResolvedValueOnce('gsk-test-groq-key')
      .mockResolvedValueOnce('AIza-test-gemini-key');

    const secrets = createMockSecrets({});
    const context = createMockContext(secrets);

    const result = await ensureApiKeys(context);

    expect(result.groq).toBe('gsk-test-groq-key');
    expect(result.gemini).toBe('AIza-test-gemini-key');
    expect(mockShowInputBox).toHaveBeenCalledTimes(2);
    expect(mockShowInputBox).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        prompt: 'Enter your Groq API key',
        password: true,
        ignoreFocusOut: true,
      }),
    );
    expect(mockShowInputBox).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        prompt: 'Enter your Gemini API key',
        password: true,
        ignoreFocusOut: true,
      }),
    );
    expect(secrets.store).toHaveBeenCalledWith('alloy.groqApiKey', 'gsk-test-groq-key');
    expect(secrets.store).toHaveBeenCalledWith('alloy.geminiApiKey', 'AIza-test-gemini-key');
  });

  it('uses stored keys without prompting', async () => {
    const secrets = createMockSecrets({
      'alloy.groqApiKey': 'stored-groq',
      'alloy.geminiApiKey': 'stored-gemini',
    });
    const context = createMockContext(secrets);

    const result = await ensureApiKeys(context);

    expect(result.groq).toBe('stored-groq');
    expect(result.gemini).toBe('stored-gemini');
    expect(mockShowInputBox).not.toHaveBeenCalled();
  });

  it('prompts only for missing key', async () => {
    mockShowInputBox.mockResolvedValueOnce('new-gemini-key');

    const secrets = createMockSecrets({ 'alloy.groqApiKey': 'existing-groq' });
    const context = createMockContext(secrets);

    const result = await ensureApiKeys(context);

    expect(result.groq).toBe('existing-groq');
    expect(result.gemini).toBe('new-gemini-key');
    expect(mockShowInputBox).toHaveBeenCalledTimes(1);
    expect(mockShowInputBox).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'Enter your Gemini API key' }),
    );
  });

  it('caches keys so subsequent calls do not re-prompt', async () => {
    mockShowInputBox
      .mockResolvedValueOnce('groq-first')
      .mockResolvedValueOnce('gemini-first');

    const secrets1 = createMockSecrets({});
    const ctx1 = createMockContext(secrets1);
    await ensureApiKeys(ctx1);

    expect(mockShowInputBox).toHaveBeenCalledTimes(2);

    const secrets2 = createMockSecrets({});
    const ctx2 = createMockContext(secrets2);
    const result2 = await ensureApiKeys(ctx2);

    expect(result2.groq).toBe('groq-first');
    expect(result2.gemini).toBe('gemini-first');
    expect(mockShowInputBox).toHaveBeenCalledTimes(2);
  });

  it('validates input and prevents empty key', async () => {
    const secrets = createMockSecrets({});
    const context = createMockContext(secrets);

    mockShowInputBox.mockImplementation(
      (options: vscode.InputBoxOptions) => {
        const validate = options.validateInput;
        if (validate) {
          const err = validate('');
          expect(err).toBe('API key cannot be empty');
        }
        return Promise.resolve('valid-key');
      },
    );

    const result = await ensureApiKeys(context);
    expect(result.groq).toBe('valid-key');
  });

  it('handles user cancellation (undefined) gracefully', async () => {
    mockShowInputBox.mockResolvedValue(undefined);

    const secrets = createMockSecrets({});
    const context = createMockContext(secrets);

    const result = await ensureApiKeys(context);

    expect(result.groq).toBe('');
    expect(result.gemini).toBe('');
  });

  it('getGroqApiKey and getGeminiApiKey return cached keys', async () => {
    resetCache();
    expect(getGroqApiKey()).toBe('');
    expect(getGeminiApiKey()).toBe('');

    mockShowInputBox
      .mockResolvedValueOnce('groq-cached')
      .mockResolvedValueOnce('gemini-cached');

    const secrets = createMockSecrets({});
    const context = createMockContext(secrets);
    await ensureApiKeys(context);

    expect(getGroqApiKey()).toBe('groq-cached');
    expect(getGeminiApiKey()).toBe('gemini-cached');
  });

  it('resetCache clears cached keys', async () => {
    mockShowInputBox
      .mockResolvedValueOnce('gk1')
      .mockResolvedValueOnce('gk2');

    const secrets = createMockSecrets({});
    const context = createMockContext(secrets);
    await ensureApiKeys(context);

    expect(getGroqApiKey()).toBe('gk1');

    resetCache();
    expect(getGroqApiKey()).toBe('');
    expect(getGeminiApiKey()).toBe('');
  });
});
