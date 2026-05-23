import * as vscode from 'vscode';

const GROQ_KEY_ID = 'alloy.groqApiKey';
const GEMINI_KEY_ID = 'alloy.geminiApiKey';

let cachedGroqKey: string | undefined;
let cachedGeminiKey: string | undefined;

export function resetCache(): void {
  cachedGroqKey = undefined;
  cachedGeminiKey = undefined;
}

export function getGroqApiKey(): string {
  return cachedGroqKey ?? process.env.GROQ_API_KEY ?? '';
}

export function getGeminiApiKey(): string {
  return cachedGeminiKey ?? process.env.GEMINI_API_KEY ?? '';
}

async function getKeyFromStorage(
  secrets: vscode.SecretStorage,
  keyId: string,
): Promise<string | undefined> {
  try {
    return await secrets.get(keyId);
  } catch {
    return undefined;
  }
}

async function promptForKey(
  label: string,
  placeHolder: string,
): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    prompt: `Enter your ${label} API key`,
    placeHolder,
    password: true,
    ignoreFocusOut: true,
    validateInput: (input: string) => {
      if (!input || input.trim().length === 0) {
        return 'API key cannot be empty';
      }
      return null;
    },
  });
  return value?.trim();
}

export async function ensureApiKeys(
  context: vscode.ExtensionContext,
): Promise<{ groq: string; gemini: string }> {
  const secrets = context.secrets;

  let groqKey = cachedGroqKey ?? await getKeyFromStorage(secrets, GROQ_KEY_ID);
  let geminiKey = cachedGeminiKey ?? await getKeyFromStorage(secrets, GEMINI_KEY_ID);

  if (!groqKey) {
    groqKey = (await promptForKey('Groq', 'gsk_...')) ?? '';
    if (groqKey) {
      await secrets.store(GROQ_KEY_ID, groqKey);
    }
  }

  if (!geminiKey) {
    geminiKey = (await promptForKey('Gemini', 'AIza...')) ?? '';
    if (geminiKey) {
      await secrets.store(GEMINI_KEY_ID, geminiKey);
    }
  }

  cachedGroqKey = groqKey;
  cachedGeminiKey = geminiKey;

  return { groq: groqKey, gemini: geminiKey };
}
