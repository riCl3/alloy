import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { LLMProviderId } from '../types';
import { getAlloyConfig, providerDefaultModel } from '../config';
import { validateProvider } from '../llmRouter';
import { getProviderStatus, saveProviderCredentials } from '../secretManager';
import { logger } from '../logger';

const VALID_PROVIDER_IDS: ReadonlySet<string> = new Set<LLMProviderId>(['groq', 'gemini', 'openaiCompatible', 'ollama']);

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function isValidHttpUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === 'https:' || (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'));
  } catch {
    return false;
  }
}

function isValidProviderId(id: unknown): id is LLMProviderId {
  return typeof id === 'string' && VALID_PROVIDER_IDS.has(id);
}

function hasValidProvider(payload: unknown): payload is { provider: LLMProviderId } {
  const p = payload as Record<string, unknown> | undefined;
  return !!p && isValidProviderId(p.provider);
}

export class SetupPanel {
  private static currentPanel: SetupPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];
  private lastMessageTime = 0;
  private static readonly RATE_LIMIT_MS = 500;

  private constructor(context: vscode.ExtensionContext, column: vscode.ViewColumn) {
    this.context = context;
    this.panel = vscode.window.createWebviewPanel(
      'alloySetup',
      'Alloy Setup',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (message) => this.handleMessage(message),
      null,
      this.disposables,
    );

    this.render();
  }

  static async createOrShow(context: vscode.ExtensionContext): Promise<void> {
    const column = vscode.ViewColumn.Active;
    if (SetupPanel.currentPanel) {
      SetupPanel.currentPanel.panel.reveal(column);
      await SetupPanel.currentPanel.render();
      return;
    }
    SetupPanel.currentPanel = new SetupPanel(context, column);
  }

  private async render(): Promise<void> {
    const config = getAlloyConfig();
    const status = await getProviderStatus(this.context);
    const nonce = randomBytes(16).toString('base64');
    this.panel.webview.html = this.getHtml(config.provider, config.model, config.reviewMode, status, nonce);
  }

  private async handleMessage(message: { type: string; payload?: unknown }): Promise<void> {
    const now = Date.now();
    if (now - this.lastMessageTime < SetupPanel.RATE_LIMIT_MS) {
      logger.warn('SetupPanel: Rate limited message');
      return;
    }
    this.lastMessageTime = now;

    switch (message.type) {
      case 'save': {
        if (!hasValidProvider(message.payload)) {
          logger.warn('SetupPanel: Invalid save payload');
          return;
        }
        const { provider } = message.payload;
        const p = message.payload as Record<string, unknown>;
        const apiKey = typeof p.apiKey === 'string' ? p.apiKey : '';
        const rawBaseUrl = typeof p.baseUrl === 'string' ? p.baseUrl : '';
        const model = typeof p.model === 'string' ? p.model : '';

        if (rawBaseUrl && !isValidHttpUrl(rawBaseUrl)) {
          this.panel.webview.postMessage({ type: 'error', message: 'Invalid base URL. Only HTTPS or localhost HTTP URLs are allowed.' });
          return;
        }

        const baseUrl = rawBaseUrl;
        try {
          await saveProviderCredentials(this.context, provider, apiKey, baseUrl);
          await vscode.workspace.getConfiguration('alloy').update('provider', provider, vscode.ConfigurationTarget.Global);
          if (model) {
            await vscode.workspace.getConfiguration('alloy').update('model', model, vscode.ConfigurationTarget.Global);
          }
          this.panel.webview.postMessage({ type: 'saved', provider });
          const status = await getProviderStatus(this.context);
          this.panel.webview.postMessage({ type: 'status', status });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.panel.webview.postMessage({ type: 'error', message: msg });
        }
        break;
      }
      case 'test': {
        if (!hasValidProvider(message.payload)) {
          logger.warn('SetupPanel: Invalid test payload');
          return;
        }
        try {
          this.panel.webview.postMessage({ type: 'testing' });
          await validateProvider(message.payload.provider);
          this.panel.webview.postMessage({ type: 'testResult', success: true });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.panel.webview.postMessage({ type: 'testResult', success: false, message: msg });
        }
        break;
      }
      case 'refresh': {
        await this.render();
        break;
      }
    }
  }

  private getHtml(
    currentProvider: LLMProviderId,
    currentModel: string,
    currentMode: string,
    status: Record<LLMProviderId, 'configured' | 'unconfigured'>,
    nonce: string,
  ): string {
    const providers: { id: LLMProviderId; label: string; description: string; needsKey: boolean; defaultUrl?: string }[] = [
      { id: 'groq', label: 'Groq', description: 'Fast inference with Llama models', needsKey: true },
      { id: 'gemini', label: 'Gemini', description: 'Google\'s multimodal AI', needsKey: true },
      { id: 'openaiCompatible', label: 'OpenAI Compatible', description: 'OpenAI, Azure, or compatible endpoints', needsKey: true, defaultUrl: 'https://api.openai.com/v1' },
      { id: 'ollama', label: 'Ollama', description: 'Local models, no API key needed', needsKey: false, defaultUrl: 'http://localhost:11434/v1' },
    ];

    const providerCards = providers.map(p => `
      <div class="provider-card ${p.id === currentProvider ? 'selected' : ''}" data-provider="${escapeHtml(p.id)}">
        <div class="provider-header">
          <span class="provider-name">${escapeHtml(p.label)}</span>
          <span class="status-badge ${escapeHtml(status[p.id])}">${status[p.id] === 'configured' ? 'Configured' : 'Not configured'}</span>
        </div>
        <p class="provider-desc">${escapeHtml(p.description)}</p>
      </div>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Alloy Setup</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-foreground);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --input-border: var(--vscode-input-border, transparent);
      --accent: var(--vscode-textLink-foreground);
      --accent-bg: var(--vscode-button-background);
      --accent-fg: var(--vscode-button-foreground);
      --hover-bg: var(--vscode-list-hoverBackground);
      --border: var(--vscode-widget-border, #444);
      --error: var(--vscode-errorForeground);
      --success: var(--vscode-terminal-ansiGreen);
      --warning: var(--vscode-editorWarning-foreground);
      --badge-bg: var(--vscode-badge-background);
      --badge-fg: var(--vscode-badge-foreground);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      color: var(--fg);
      background: var(--bg);
      padding: 24px;
      max-width: 680px;
      margin: 0 auto;
    }
    h1 {
      font-size: 1.6em;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .subtitle {
      color: var(--fg);
      opacity: 0.7;
      margin-bottom: 24px;
      font-size: 0.9em;
    }
    .section-title {
      font-size: 0.85em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.6;
      margin-bottom: 12px;
    }
    .provider-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 24px;
    }
    .provider-card {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 14px;
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .provider-card:hover {
      border-color: var(--accent);
      background: var(--hover-bg);
    }
    .provider-card.selected {
      border-color: var(--accent);
      background: var(--hover-bg);
    }
    .provider-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .provider-name { font-weight: 600; font-size: 1em; }
    .status-badge {
      font-size: 0.7em;
      padding: 2px 6px;
      border-radius: 3px;
      background: var(--badge-bg);
      color: var(--badge-fg);
    }
    .status-badge.configured { border-left: 3px solid var(--success); }
    .status-badge.unconfigured { border-left: 3px solid var(--warning); }
    .provider-desc { font-size: 0.85em; opacity: 0.7; }

    .config-panel {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .config-panel.hidden { display: none; }
    .field-group { margin-bottom: 16px; }
    .field-group:last-child { margin-bottom: 0; }
    .field-label {
      display: block;
      font-size: 0.85em;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .field-hint {
      font-size: 0.75em;
      opacity: 0.5;
      margin-bottom: 4px;
    }
    input[type="text"], input[type="password"] {
      width: 100%;
      padding: 8px 10px;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      font-family: var(--vscode-font-family, monospace);
      font-size: 0.9em;
    }
    input:focus {
      outline: 1px solid var(--accent);
      border-color: var(--accent);
    }
    .actions {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    button {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9em;
      font-weight: 500;
    }
    .btn-primary {
      background: var(--accent-bg);
      color: var(--accent-fg);
    }
    .btn-primary:hover { opacity: 0.9; }
    .btn-secondary {
      background: transparent;
      color: var(--fg);
      border: 1px solid var(--border);
    }
    .btn-secondary:hover { border-color: var(--accent); }
    .btn-primary:disabled, .btn-secondary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .status-msg {
      font-size: 0.85em;
      padding: 8px 12px;
      border-radius: 4px;
      margin-top: 12px;
    }
    .status-msg.success { background: rgba(0,200,0,0.1); color: var(--success); }
    .status-msg.error { background: rgba(255,0,0,0.1); color: var(--error); }
    .status-msg.testing { opacity: 0.7; }
    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid var(--fg);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .current-config {
      font-size: 0.85em;
      opacity: 0.7;
      margin-bottom: 20px;
    }
    .current-config strong { opacity: 1; }
  </style>
</head>
<body>
  <h1>Alloy Setup</h1>
  <p class="subtitle">Configure your AI code review provider</p>
  <p class="current-config">
    Active: <strong>${escapeHtml(currentProvider)}</strong> | Model: <strong>${escapeHtml(currentModel || providerDefaultModel(currentProvider))}</strong> | Mode: <strong>${escapeHtml(currentMode)}</strong>
  </p>

  <div class="section-title">Provider</div>
  <div class="provider-grid">
    ${providerCards}
  </div>

  <div class="config-panel hidden" id="configPanel">
    <div class="field-group" id="apiKeyGroup">
      <label class="field-label">API Key</label>
      <p class="field-hint" id="apiKeyHint">Enter your API key</p>
      <input type="password" id="apiKey" placeholder="gsk_..." />
    </div>
    <div class="field-group" id="baseUrlGroup" style="display:none">
      <label class="field-label">Base URL</label>
      <p class="field-hint">Endpoint URL for the provider</p>
      <input type="text" id="baseUrl" />
    </div>
    <div class="field-group">
      <label class="field-label">Model</label>
      <p class="field-hint">Leave empty to use the default model</p>
      <input type="text" id="model" />
    </div>
    <div class="actions">
      <button class="btn-primary" id="saveBtn">Save Configuration</button>
      <button class="btn-secondary" id="testBtn">Test Connection</button>
    </div>
    <div id="statusMsg"></div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let selectedProvider = '${escapeJsString(currentProvider)}';
    const defaults = {
      groq: { keyPlaceholder: 'gsk_...', url: '' },
      gemini: { keyPlaceholder: 'AIza...', url: '' },
      openaiCompatible: { keyPlaceholder: 'sk-...', url: 'https://api.openai.com/v1' },
      ollama: { keyPlaceholder: '', url: 'http://localhost:11434/v1' },
    };

    const models = {
      groq: '${escapeJsString(providerDefaultModel('groq'))}',
      gemini: '${escapeJsString(providerDefaultModel('gemini'))}',
      openaiCompatible: '${escapeJsString(providerDefaultModel('openaiCompatible'))}',
      ollama: '${escapeJsString(providerDefaultModel('ollama'))}',
    };

    function selectProvider(id) {
      selectedProvider = id;
      document.querySelectorAll('.provider-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.provider === id);
      });
      const panel = document.getElementById('configPanel');
      panel.classList.remove('hidden');
      const apiKeyGroup = document.getElementById('apiKeyGroup');
      const baseUrlGroup = document.getElementById('baseUrlGroup');
      const apiKeyInput = document.getElementById('apiKey');
      const baseUrlInput = document.getElementById('baseUrl');
      const modelInput = document.getElementById('model');

      if (id === 'ollama') {
        apiKeyGroup.style.display = 'none';
      } else {
        apiKeyGroup.style.display = '';
        apiKeyInput.placeholder = defaults[id].keyPlaceholder;
      }
      if (defaults[id].url) {
        baseUrlGroup.style.display = '';
        baseUrlInput.value = defaults[id].url;
      } else {
        baseUrlGroup.style.display = 'none';
      }
      modelInput.value = models[id] || '';
      modelInput.placeholder = models[id] || 'Model name';
    }

    document.querySelectorAll('.provider-card').forEach(card => {
      card.addEventListener('click', () => selectProvider(card.dataset.provider));
    });

    document.getElementById('saveBtn').addEventListener('click', () => {
      const payload = {
        provider: selectedProvider,
        apiKey: document.getElementById('apiKey').value,
        baseUrl: document.getElementById('baseUrl').value,
        model: document.getElementById('model').value,
      };
      vscode.postMessage({ type: 'save', payload });
    });

    document.getElementById('testBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'test', payload: { provider: selectedProvider } });
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      const el = document.getElementById('statusMsg');
      if (msg.type === 'saved') {
        el.className = 'status-msg success';
        el.textContent = 'Configuration saved for ' + msg.provider;
      } else if (msg.type === 'testing') {
        el.className = 'status-msg testing';
        el.textContent = '';
        const spinner = document.createElement('span');
        spinner.className = 'spinner';
        el.appendChild(spinner);
        el.append(' Testing connection...');
      } else if (msg.type === 'testResult') {
        if (msg.success) {
          el.className = 'status-msg success';
          el.textContent = 'Connection successful!';
        } else {
          el.className = 'status-msg error';
          el.textContent = 'Connection failed: ' + (msg.message || 'Unknown error');
        }
      } else if (msg.type === 'error') {
        el.className = 'status-msg error';
        el.textContent = 'Error: ' + msg.message;
      } else if (msg.type === 'status') {
        // Update status badges
        document.querySelectorAll('.provider-card').forEach(card => {
          const id = card.dataset.provider;
          const badge = card.querySelector('.status-badge');
          if (msg.status[id]) {
            badge.className = 'status-badge ' + msg.status[id];
            badge.textContent = msg.status[id] === 'configured' ? 'Configured' : 'Not configured';
          }
        });
      }
    });

    // Auto-select current provider
    selectProvider(selectedProvider);
  </script>
</body>
</html>`;
  }

  private dispose(): void {
    SetupPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}
