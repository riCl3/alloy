import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { LLMProviderId } from '../types';
import { getAlloyConfig, providerDefaultModel } from '../config';
import { validateProvider } from '../llmRouter';
import { getProviderStatus, saveProviderCredentials } from '../secretManager';
import { getOllamaStatus } from '../ollamaHelper';
import { OLLAMA_MODEL_PROFILES, RECOMMENDED_MODEL_TAG } from '../ollamaProfiles';
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

// ─── TIER COLOURS ───────────────────────────────────────────────

const TIER_COLORS: Record<string, string> = {
  experimental: 'var(--vscode-editorWarning-foreground)',
  lightweight: 'var(--vscode-charts-yellow)',
  balanced: 'var(--vscode-textLink-foreground)',
  strong: 'var(--vscode-terminal-ansiGreen)',
};

const TIER_LABELS: Record<string, string> = {
  experimental: 'Experimental',
  lightweight: 'Lightweight',
  balanced: 'Balanced',
  strong: 'Strong',
};

// ═══════════════════════════════════════════════════════════════════
// SetupPanel
// ═══════════════════════════════════════════════════════════════════

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

  // ─── Render ──────────────────────────────────────────────────

  private async render(): Promise<void> {
    const config = getAlloyConfig();
    const status = await getProviderStatus(this.context);
    const ollamaStatus = await getOllamaStatus();
    const nonce = randomBytes(16).toString('base64');
    this.panel.webview.html = this.getHtml(config.provider, config.model, config.reviewMode, status, ollamaStatus, nonce);
  }

  // ─── Message handling ────────────────────────────────────────

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
        const p = message.payload as Record<string, unknown>;
        const testProvider = p.provider as LLMProviderId;
        const testApiKey = typeof p.apiKey === 'string' ? p.apiKey : '';
        const testBaseUrl = typeof p.baseUrl === 'string' ? p.baseUrl : '';
        const testModel = typeof p.model === 'string' ? p.model : '';
        try {
          this.panel.webview.postMessage({ type: 'testing' });
          // Save credentials first so validateProvider can find them
          if (testProvider !== 'ollama') {
            await saveProviderCredentials(this.context, testProvider, testApiKey, testBaseUrl);
          } else if (testBaseUrl) {
            await saveProviderCredentials(this.context, testProvider, '', testBaseUrl);
          }
          await validateProvider(testProvider, testModel ? { model: testModel } : undefined);
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
      case 'ollama:pull': {
        const tag = typeof message.payload === 'string' ? message.payload : '';
        if (!tag) return;
        // Pull from the extension host (webview can't reach localhost)
        this.handleOllamaPull(tag);
        break;
      }
      case 'ollama:checkStatus': {
        const ollamaStatus = await getOllamaStatus();
        this.panel.webview.postMessage({ type: 'ollama:status', status: ollamaStatus });
        break;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // HTML — complete redesign
  // ═══════════════════════════════════════════════════════════════

  private getHtml(
    currentProvider: LLMProviderId,
    currentModel: string,
    currentMode: string,
    status: Record<LLMProviderId, 'configured' | 'unconfigured'>,
    ollamaStatus: { running: boolean; installedModels: string[]; version?: string },
    nonce: string,
  ): string {
    // Pre-serialize model profiles for JS
    const profilesJson = JSON.stringify(OLLAMA_MODEL_PROFILES);
    const recommendedTag = RECOMMENDED_MODEL_TAG;

    // Build installed model tags set for JS
    const installedJson = JSON.stringify(ollamaStatus.installedModels);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Alloy Setup</title>
  <style>
    /* ── Tokens ─────────────────────────────────────────────── */
    :root {
      --bg: var(--vscode-editor-background);
      --bg-alt: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      --fg: var(--vscode-foreground);
      --fg-muted: color-mix(in srgb, var(--fg) 55%, transparent);
      --fg-subtle: color-mix(in srgb, var(--fg) 35%, transparent);
      --accent: var(--vscode-textLink-foreground);
      --accent-bg: var(--vscode-button-background);
      --accent-fg: var(--vscode-button-foreground);
      --hover-bg: var(--vscode-list-hoverBackground);
      --border: var(--vscode-widget-border, color-mix(in srgb, var(--fg) 12%, transparent));
      --border-strong: color-mix(in srgb, var(--fg) 22%, transparent);
      --error: var(--vscode-errorForeground);
      --success: var(--vscode-terminal-ansiGreen);
      --warning: var(--vscode-editorWarning-foreground);
      --badge-bg: var(--vscode-badge-background);
      --badge-fg: var(--vscode-badge-foreground);
      --card-radius: 10px;
      --transition: 180ms ease;
    }

    /* ── Reset ──────────────────────────────────────────────── */
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
      color: var(--fg);
      background: var(--bg);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }

    /* ── Layout ─────────────────────────────────────────────── */
    .shell {
      max-width: 720px;
      margin: 0 auto;
      padding: 32px 28px 48px;
    }

    /* ── Hero / Header ──────────────────────────────────────── */
    .hero {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 8px;
    }
    .hero-icon {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: var(--accent-bg);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      color: var(--accent-fg);
      flex-shrink: 0;
    }
    .hero h1 {
      font-size: 1.45em;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .hero-sub {
      font-size: 0.82em;
      color: var(--fg-muted);
      margin-bottom: 28px;
      padding-left: 50px;
    }
    .current-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--bg-alt);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 4px 12px;
      font-size: 0.78em;
      color: var(--fg-muted);
      margin-bottom: 28px;
    }
    .current-pill .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--success);
      flex-shrink: 0;
    }
    .current-pill .dot.unconfigured { background: var(--warning); }

    /* ── Section headers ─────────────────────────────────────── */
    .section-label {
      font-size: 0.72em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--fg-subtle);
      margin-bottom: 10px;
    }

    /* ── Provider cards ──────────────────────────────────────── */
    .provider-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 24px;
    }
    .p-card {
      position: relative;
      border: 1.5px solid var(--border);
      border-radius: var(--card-radius);
      padding: 16px 14px 14px;
      cursor: pointer;
      transition: border-color var(--transition), background var(--transition), box-shadow var(--transition);
      background: var(--bg-alt);
    }
    .p-card:hover {
      border-color: var(--border-strong);
      background: var(--hover-bg);
    }
    .p-card.selected {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent);
    }
    .p-card-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 5px;
    }
    .p-card-name {
      font-weight: 600;
      font-size: 0.92em;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .p-badge {
      font-size: 0.62em;
      padding: 2px 7px;
      border-radius: 4px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .p-badge.cloud { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); }
    .p-badge.local { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success); }
    .p-status {
      font-size: 0.68em;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 500;
    }
    .p-status.configured { color: var(--success); background: color-mix(in srgb, var(--success) 10%, transparent); }
    .p-status.unconfigured { color: var(--fg-subtle); background: var(--bg-alt); border: 1px solid var(--border); }
    .p-card-desc {
      font-size: 0.78em;
      color: var(--fg-muted);
      line-height: 1.45;
    }

    /* ── Config panel ────────────────────────────────────────── */
    .config-panel {
      border: 1px solid var(--border);
      border-radius: var(--card-radius);
      padding: 22px 20px;
      margin-bottom: 24px;
      background: var(--bg-alt);
      transition: opacity var(--transition);
    }
    .config-panel.hidden { display: none; }
    .field { margin-bottom: 16px; }
    .field:last-child { margin-bottom: 0; }
    .field-label {
      display: block;
      font-size: 0.8em;
      font-weight: 600;
      margin-bottom: 5px;
      color: var(--fg);
    }
    .field-hint {
      font-size: 0.72em;
      color: var(--fg-subtle);
      margin-bottom: 5px;
    }
    input[type="text"], input[type="password"] {
      width: 100%;
      padding: 8px 11px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--border));
      border-radius: 6px;
      font-family: var(--vscode-font-family, monospace);
      font-size: 0.85em;
      outline: none;
      transition: border-color var(--transition);
    }
    input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent);
    }
    .btn-row {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-top: 18px;
    }
    button {
      padding: 8px 18px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85em;
      font-weight: 600;
      transition: opacity var(--transition), background var(--transition);
    }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn-primary {
      background: var(--accent-bg);
      color: var(--accent-fg);
    }
    .btn-primary:hover:not(:disabled) { opacity: 0.88; }
    .btn-secondary {
      background: transparent;
      color: var(--fg);
      border: 1px solid var(--border);
    }
    .btn-secondary:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
    .btn-sm {
      padding: 5px 12px;
      font-size: 0.75em;
      border-radius: 5px;
    }
    .btn-ghost {
      background: transparent;
      color: var(--accent);
      padding: 4px 8px;
      font-size: 0.75em;
    }
    .btn-ghost:hover { text-decoration: underline; }

    /* ── Status messages ─────────────────────────────────────── */
    .status-msg {
      font-size: 0.82em;
      padding: 10px 14px;
      border-radius: 6px;
      margin-top: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status-msg.success { background: color-mix(in srgb, var(--success) 10%, transparent); color: var(--success); }
    .status-msg.error { background: color-mix(in srgb, var(--error) 10%, transparent); color: var(--error); }
    .status-msg.testing { color: var(--fg-muted); }
    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid var(--fg-subtle);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Ollama section ──────────────────────────────────────── */
    .ollama-section {
      margin-bottom: 24px;
    }
    .ollama-banner {
      border: 1px solid var(--border);
      border-radius: var(--card-radius);
      padding: 16px 18px;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .ollama-banner.running { border-color: color-mix(in srgb, var(--success) 40%, transparent); }
    .ollama-banner.not-running { border-color: color-mix(in srgb, var(--warning) 40%, transparent); }
    .ollama-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .ollama-dot.on { background: var(--success); box-shadow: 0 0 6px color-mix(in srgb, var(--success) 50%, transparent); }
    .ollama-dot.off { background: var(--warning); }
    .ollama-banner-text { flex: 1; }
    .ollama-banner-title { font-weight: 600; font-size: 0.88em; }
    .ollama-banner-sub { font-size: 0.75em; color: var(--fg-muted); }

    /* Model cards */
    .model-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
    }
    .m-card {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 14px;
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 10px;
      transition: border-color var(--transition), background var(--transition);
      background: var(--bg-alt);
    }
    .m-card:hover { border-color: var(--border-strong); }
    .m-card.installed { border-left: 3px solid var(--success); }
    .m-card.recommended { border-left: 3px solid var(--accent); }
    .m-info { min-width: 0; }
    .m-name {
      font-weight: 600;
      font-size: 0.85em;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .m-tag {
      font-size: 0.68em;
      font-family: var(--vscode-font-family, monospace);
      color: var(--fg-subtle);
      background: var(--bg);
      padding: 1px 6px;
      border-radius: 3px;
    }
    .m-desc {
      font-size: 0.75em;
      color: var(--fg-muted);
      margin-top: 2px;
    }
    .m-meta {
      display: flex;
      gap: 10px;
      margin-top: 5px;
      font-size: 0.68em;
      color: var(--fg-subtle);
    }
    .m-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .tier-badge {
      font-size: 0.62em;
      padding: 2px 7px;
      border-radius: 4px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .speed-bar, .quality-bar {
      display: flex;
      gap: 2px;
      align-items: center;
    }
    .speed-bar .pip, .quality-bar .pip {
      width: 4px;
      height: 10px;
      border-radius: 1px;
      background: var(--border);
    }
    .speed-bar .pip.on { background: var(--accent); }
    .quality-bar .pip.on { background: var(--success); }

    /* Download progress */
    .download-progress {
      margin-top: 6px;
      height: 3px;
      background: var(--border);
      border-radius: 2px;
      overflow: hidden;
    }
    .download-progress .bar {
      height: 100%;
      background: var(--accent);
      border-radius: 2px;
      transition: width 300ms ease;
    }
    .download-status {
      font-size: 0.7em;
      color: var(--fg-muted);
      margin-top: 3px;
    }

    /* ── Divider ─────────────────────────────────────────────── */
    .divider {
      border: none;
      border-top: 1px solid var(--border);
      margin: 24px 0;
    }

    /* ── Review mode pills ───────────────────────────────────── */
    .mode-pills {
      display: flex;
      gap: 8px;
      margin-bottom: 24px;
    }
    .mode-pill {
      padding: 6px 14px;
      border-radius: 20px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--fg-muted);
      font-size: 0.78em;
      font-weight: 500;
      cursor: pointer;
      transition: all var(--transition);
    }
    .mode-pill:hover { border-color: var(--border-strong); }
    .mode-pill.active {
      border-color: var(--accent);
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 8%, transparent);
    }

    /* ── Responsive ──────────────────────────────────────────── */
    @media (max-width: 520px) {
      .provider-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <!-- ── Hero ─────────────────────────────────────────────── -->
    <div class="hero">
      <div class="hero-icon">⚡</div>
      <h1>Alloy Setup</h1>
    </div>
    <p class="hero-sub">Configure your AI code review provider</p>

    <div class="current-pill">
      <span class="dot ${status[currentProvider] === 'configured' ? '' : 'unconfigured'}"></span>
      Active: <strong>${escapeHtml(currentProvider)}</strong>&nbsp;·&nbsp;
      Model: <strong>${escapeHtml(currentModel || providerDefaultModel(currentProvider))}</strong>&nbsp;·&nbsp;
      Mode: <strong>${escapeHtml(currentMode)}</strong>
    </div>

    <!-- ── Review mode ───────────────────────────────────────── -->
    <div class="section-label">Review Mode</div>
    <div class="mode-pills">
      <div class="mode-pill ${currentMode === 'fast' ? 'active' : ''}" data-mode="fast">⚡ Fast</div>
      <div class="mode-pill ${currentMode === 'deep' ? 'active' : ''}" data-mode="deep">🔍 Deep</div>
      <div class="mode-pill ${currentMode === 'architecture' ? 'active' : ''}" data-mode="architecture">🏗️ Architecture</div>
    </div>

    <!-- ── Providers ─────────────────────────────────────────── -->
    <div class="section-label">Provider</div>
    <div class="provider-grid" id="providerGrid">
      <div class="p-card ${currentProvider === 'groq' ? 'selected' : ''}" data-provider="groq">
        <div class="p-card-head">
          <span class="p-card-name">Groq <span class="p-badge cloud">Cloud</span></span>
          <span class="p-status ${status.groq}">${status.groq === 'configured' ? '✓ Ready' : 'Setup needed'}</span>
        </div>
        <p class="p-card-desc">Fast inference with Llama models. Free tier available.</p>
      </div>
      <div class="p-card ${currentProvider === 'gemini' ? 'selected' : ''}" data-provider="gemini">
        <div class="p-card-head">
          <span class="p-card-name">Gemini <span class="p-badge cloud">Cloud</span></span>
          <span class="p-status ${status.gemini}">${status.gemini === 'configured' ? '✓ Ready' : 'Setup needed'}</span>
        </div>
        <p class="p-card-desc">Google's multimodal AI. Generous free quota.</p>
      </div>
      <div class="p-card ${currentProvider === 'openaiCompatible' ? 'selected' : ''}" data-provider="openaiCompatible">
        <div class="p-card-head">
          <span class="p-card-name">OpenAI Compatible <span class="p-badge cloud">Cloud</span></span>
          <span class="p-status ${status.openaiCompatible}">${status.openaiCompatible === 'configured' ? '✓ Ready' : 'Setup needed'}</span>
        </div>
        <p class="p-card-desc">OpenAI, Azure, or any compatible endpoint.</p>
      </div>
      <div class="p-card ${currentProvider === 'ollama' ? 'selected' : ''}" data-provider="ollama">
        <div class="p-card-head">
          <span class="p-card-name">Ollama <span class="p-badge local">Local</span></span>
          <span class="p-status ${status.ollama}">${status.ollama === 'configured' ? '✓ Ready' : 'Setup needed'}</span>
        </div>
        <p class="p-card-desc">Run models locally. No API key. Full privacy.</p>
      </div>
    </div>

    <!-- ── Config panel ──────────────────────────────────────── -->
    <div class="config-panel hidden" id="configPanel">
      <div class="field" id="apiKeyGroup">
        <label class="field-label">API Key</label>
        <p class="field-hint" id="apiKeyHint">Enter your provider API key</p>
        <input type="password" id="apiKey" placeholder="gsk_..." />
      </div>
      <div class="field" id="baseUrlGroup" style="display:none">
        <label class="field-label">Base URL</label>
        <p class="field-hint">Endpoint URL for the provider</p>
        <input type="text" id="baseUrl" />
      </div>
      <div class="field">
        <label class="field-label">Model</label>
        <p class="field-hint">Leave empty to use the default model</p>
        <input type="text" id="model" />
      </div>
      <div class="btn-row">
        <button class="btn-primary" id="saveBtn">Save Configuration</button>
        <button class="btn-secondary" id="testBtn">Test Connection</button>
      </div>
      <div id="statusMsg"></div>
    </div>

    <!-- ── Ollama guided section ─────────────────────────────── -->
    <div class="ollama-section" id="ollamaSection" style="display:none">
      <hr class="divider" />
      <div class="section-label">Ollama Models</div>

      <div class="ollama-banner ${ollamaStatus.running ? 'running' : 'not-running'}" id="ollamaBanner">
        <span class="ollama-dot ${ollamaStatus.running ? 'on' : 'off'}"></span>
        <div class="ollama-banner-text">
          <div class="ollama-banner-title" id="ollamaBannerTitle">
            ${ollamaStatus.running ? 'Ollama is running' : 'Ollama not detected'}
          </div>
          <div class="ollama-banner-sub" id="ollamaBannerSub">
            ${ollamaStatus.running
              ? `Version ${ollamaStatus.version ?? 'unknown'} · ${ollamaStatus.installedModels.length} model(s) installed`
              : 'Install from <a href="https://ollama.com" target="_blank" style="color:var(--accent)">ollama.com</a> to run local models'}
          </div>
        </div>
        <button class="btn-secondary btn-sm" id="ollamaRefreshBtn">Refresh</button>
      </div>

      <div class="model-grid" id="modelGrid"></div>
    </div>

  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // ── Data ──────────────────────────────────────────────────
    const profiles = ${profilesJson};
    const installedRaw = ${installedJson};
    let selectedProvider = '${escapeJsString(currentProvider)}';
    let ollamaRunning = ${ollamaStatus.running ? 'true' : 'false'};

    const defaults = {
      groq:              { keyPlaceholder: 'gsk_...',      url: '' },
      gemini:            { keyPlaceholder: 'AIza...',     url: '' },
      openaiCompatible:  { keyPlaceholder: 'sk-...',      url: 'https://api.openai.com/v1' },
      ollama:            { keyPlaceholder: '',            url: 'http://localhost:11434/v1' },
    };
    const models = {
      groq: '${escapeJsString(providerDefaultModel('groq'))}',
      gemini: '${escapeJsString(providerDefaultModel('gemini'))}',
      openaiCompatible: '${escapeJsString(providerDefaultModel('openaiCompatible'))}',
      ollama: '${escapeJsString(providerDefaultModel('ollama'))}',
    };

    // ── Provider selection ────────────────────────────────────
    function selectProvider(id) {
      selectedProvider = id;
      document.querySelectorAll('.p-card').forEach(c => c.classList.toggle('selected', c.dataset.provider === id));

      const panel = document.getElementById('configPanel');
      const ollamaSection = document.getElementById('ollamaSection');
      const apiKeyGroup = document.getElementById('apiKeyGroup');
      const baseUrlGroup = document.getElementById('baseUrlGroup');
      const apiKeyInput = document.getElementById('apiKey');
      const baseUrlInput = document.getElementById('baseUrl');
      const modelInput = document.getElementById('model');

      panel.classList.remove('hidden');

      if (id === 'ollama') {
        apiKeyGroup.style.display = 'none';
        baseUrlGroup.style.display = '';
        baseUrlInput.value = defaults.ollama.url;
        modelInput.value = models.ollama || '';
        modelInput.placeholder = models.ollama || 'Model name';
        ollamaSection.style.display = '';
        renderModelGrid();
      } else {
        apiKeyGroup.style.display = '';
        baseUrlGroup.style.display = defaults[id].url ? '' : 'none';
        if (defaults[id].url) baseUrlInput.value = defaults[id].url;
        apiKeyInput.placeholder = defaults[id].keyPlaceholder;
        modelInput.value = models[id] || '';
        modelInput.placeholder = models[id] || 'Model name';
        ollamaSection.style.display = 'none';
      }
    }

    // ── Model grid ────────────────────────────────────────────
    function isModelInstalled(tag) {
      return installedRaw.some(installed => {
        const base = installed.split('-q')[0].split('-f16')[0];
        return base === tag || installed === tag;
      });
    }

    function renderModelGrid() {
      const grid = document.getElementById('modelGrid');
      grid.innerHTML = '';
      for (const p of profiles) {
        const installed = isModelInstalled(p.tag);
        const isRecommended = p.tag === '${recommendedTag}';
        const card = document.createElement('div');
        card.className = 'm-card' + (installed ? ' installed' : '') + (isRecommended ? ' recommended' : '');

        const speedPips = Array.from({length: 5}, (_, i) =>
          '<span class="pip' + (i < p.speed ? ' on' : '') + '"></span>'
        ).join('');
        const qualityPips = Array.from({length: 5}, (_, i) =>
          '<span class="pip' + (i < p.quality ? ' on' : '') + '"></span>'
        ).join('');

        const tierColors = ${JSON.stringify(TIER_COLORS)};
        const tierLabels = ${JSON.stringify(TIER_LABELS)};

        card.innerHTML =
          '<div class="m-info">' +
            '<div class="m-name">' +
              p.name +
              (isRecommended ? ' <span class="tier-badge" style="background:color-mix(in srgb, var(--accent) 15%, transparent);color:var(--accent);">Recommended</span>' : '') +
              (installed ? ' <span class="tier-badge" style="background:color-mix(in srgb, var(--success) 15%, transparent);color:var(--success);">Installed</span>' : '') +
            '</div>' +
            '<div class="m-desc">' + p.description + '</div>' +
            '<div class="m-meta">' +
              '<span>' + p.downloadSizeMB + ' MB</span>' +
              '<span>' + p.ramGB + ' GB RAM</span>' +
              '<span class="tier-badge" style="background:color-mix(in srgb, ' + (tierColors[p.tier] || 'var(--accent)') + ' 15%, transparent);color:' + (tierColors[p.tier] || 'var(--accent)') + ';">' + (tierLabels[p.tier] || p.tier) + '</span>' +
            '</div>' +
            '<div class="m-meta">' +
              '<span style="display:flex;align-items:center;gap:4px;">Speed <span class="speed-bar">' + speedPips + '</span></span>' +
              '<span style="display:flex;align-items:center;gap:4px;">Quality <span class="quality-bar">' + qualityPips + '</span></span>' +
            '</div>' +
            '<div class="download-progress" id="progress-' + p.tag.replace(/:/g, '-') + '" style="display:none"><div class="bar" style="width:0%"></div></div>' +
            '<div class="download-status" id="dlstatus-' + p.tag.replace(/:/g, '-') + '"></div>' +
          '</div>' +
          '<div class="m-actions">' +
            (installed
              ? '<button class="btn-ghost btn-sm" disabled>Installed</button>'
              : '<button class="btn-primary btn-sm pull-btn" data-tag="' + p.tag + '"' + (ollamaRunning ? '' : ' disabled title="Start Ollama first"') + '>Pull</button>') +
          '</div>';

        grid.appendChild(card);
      }

      // Wire pull buttons
      grid.querySelectorAll('.pull-btn').forEach(btn => {
        btn.addEventListener('click', () => startPull(btn.dataset.tag));
      });
    }

    // ── Pull model (routed through extension host) ────────────
    function startPull(tag) {
      const btn = document.querySelector('.pull-btn[data-tag="' + tag + '"]');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Pulling...';
      }
      const progressEl = document.getElementById('progress-' + tag.replace(/:/g, '-'));
      if (progressEl) progressEl.style.display = '';
      const statusEl = document.getElementById('dlstatus-' + tag.replace(/:/g, '-'));
      if (statusEl) statusEl.textContent = 'Starting download...';

      vscode.postMessage({ type: 'ollama:pull', payload: tag });
    }

    // ── Message handling ──────────────────────────────────────
    window.addEventListener('message', event => {
      const msg = event.data;
      const el = document.getElementById('statusMsg');
      if (msg.type === 'saved') {
        el.className = 'status-msg success';
        el.innerHTML = '✓ Configuration saved for <strong>' + msg.provider + '</strong>';
      } else if (msg.type === 'testing') {
        el.className = 'status-msg testing';
        el.innerHTML = '<span class="spinner"></span> Testing connection...';
      } else if (msg.type === 'testResult') {
        if (msg.success) {
          el.className = 'status-msg success';
          el.textContent = '✓ Connection successful!';
        } else {
          el.className = 'status-msg error';
          el.textContent = '✗ Connection failed: ' + (msg.message || 'Unknown error');
        }
      } else if (msg.type === 'error') {
        el.className = 'status-msg error';
        el.textContent = '✗ ' + msg.message;
      } else if (msg.type === 'status') {
        document.querySelectorAll('.p-card').forEach(card => {
          const id = card.dataset.provider;
          const badge = card.querySelector('.p-status');
          if (msg.status[id]) {
            badge.className = 'p-status ' + msg.status[id];
            badge.textContent = msg.status[id] === 'configured' ? '✓ Ready' : 'Setup needed';
          }
        });
      } else if (msg.type === 'ollama:pullProgress') {
        const tag = msg.tag;
        const safeId = tag.replace(/:/g, '-');
        const progressEl = document.getElementById('progress-' + safeId);
        const statusEl = document.getElementById('dlstatus-' + safeId);
        if (progressEl && msg.percent >= 0) {
          progressEl.querySelector('.bar').style.width = msg.percent + '%';
        }
        if (statusEl) {
          statusEl.textContent = msg.percent >= 0
            ? msg.status + ' (' + msg.percent + '%)'
            : msg.status;
        }
      } else if (msg.type === 'ollama:pullDone') {
        const tag = msg.tag;
        const safeId = tag.replace(/:/g, '-');
        const progressEl = document.getElementById('progress-' + safeId);
        const statusEl = document.getElementById('dlstatus-' + safeId);
        const btn = document.querySelector('.pull-btn[data-tag="' + tag + '"]');
        if (msg.success) {
          if (progressEl) {
            progressEl.querySelector('.bar').style.width = '100%';
          }
          if (statusEl) statusEl.textContent = '✓ Download complete';
        } else {
          if (statusEl) statusEl.textContent = '✗ ' + (msg.message || 'Pull failed');
          if (btn) {
            btn.disabled = false;
            btn.textContent = 'Pull';
          }
        }
      } else if (msg.type === 'ollama:status') {
        ollamaRunning = msg.status.running;
        const banner = document.getElementById('ollamaBanner');
        const bannerTitle = document.getElementById('ollamaBannerTitle');
        const bannerSub = document.getElementById('ollamaBannerSub');
        if (msg.status.running) {
          banner.className = 'ollama-banner running';
          bannerTitle.textContent = 'Ollama is running';
          bannerSub.textContent = 'Version ' + (msg.status.version || 'unknown') + ' · ' + msg.status.installedModels.length + ' model(s) installed';
        } else {
          banner.className = 'ollama-banner not-running';
          bannerTitle.textContent = 'Ollama not detected';
          bannerSub.innerHTML = 'Install from <a href="https://ollama.com" target="_blank" style="color:var(--accent)">ollama.com</a> to run local models';
        }
        renderModelGrid();
      } else if (msg.type === 'ollama:autoConfigured') {
        // After a successful pull, auto-select Ollama provider and fill in the model
        selectProvider('ollama');
        document.getElementById('model').value = msg.tag;
        document.getElementById('statusMsg').className = 'status-msg success';
        document.getElementById('statusMsg').textContent = '\u2713 Model pulled and configured: ' + msg.tag;
      }
    });

    // ── Wire up buttons ───────────────────────────────────────
    document.querySelectorAll('.p-card').forEach(card => {
      card.addEventListener('click', () => selectProvider(card.dataset.provider));
    });

    document.getElementById('saveBtn').addEventListener('click', () => {
      vscode.postMessage({
        type: 'save',
        payload: {
          provider: selectedProvider,
          apiKey: document.getElementById('apiKey').value,
          baseUrl: document.getElementById('baseUrl').value,
          model: document.getElementById('model').value,
        },
      });
    });

    document.getElementById('testBtn').addEventListener('click', () => {
      vscode.postMessage({
        type: 'test',
        payload: {
          provider: selectedProvider,
          apiKey: document.getElementById('apiKey').value,
          baseUrl: document.getElementById('baseUrl').value,
          model: document.getElementById('model').value,
        },
      });
    });

    document.getElementById('ollamaRefreshBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'ollama:checkStatus' });
    });

    document.querySelectorAll('.mode-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.mode-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        // Save mode via workspace config
        vscode.postMessage({ type: 'save', payload: { provider: selectedProvider, model: document.getElementById('model').value } });
      });
    });

    // ── Init ──────────────────────────────────────────────────
    selectProvider(selectedProvider);
  </script>
</body>
</html>`;
  }

  // ─── Ollama pull from extension host ──────────────────────

  private async handleOllamaPull(tag: string): Promise<void> {
    const baseUrl = 'http://localhost:11434';
    try {
      this.panel.webview.postMessage({ type: 'ollama:pullStarted', tag });

      const response = await fetch(`${baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tag, stream: true }),
      });

      if (!response.ok) {
        throw new Error(`Pull failed: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('Pull returned no body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line) as {
              status?: string;
              total?: number;
              completed?: number;
            };
            if (data.total && data.completed != null) {
              const pct = Math.round((data.completed / data.total) * 100);
              this.panel.webview.postMessage({
                type: 'ollama:pullProgress',
                tag,
                percent: pct,
                status: data.status ?? 'downloading',
              });
            } else if (data.status) {
              this.panel.webview.postMessage({
                type: 'ollama:pullProgress',
                tag,
                percent: -1,
                status: data.status,
              });
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }

      // Auto-configure: set provider to ollama, model to the pulled tag
      await vscode.workspace.getConfiguration('alloy').update('provider', 'ollama', vscode.ConfigurationTarget.Global);
      await vscode.workspace.getConfiguration('alloy').update('model', tag, vscode.ConfigurationTarget.Global);
      this.panel.webview.postMessage({ type: 'ollama:pullDone', tag, success: true });
      // Refresh status after pull
      const ollamaStatus = await getOllamaStatus();
      this.panel.webview.postMessage({ type: 'ollama:status', status: ollamaStatus });
      // Tell webview to select ollama and fill in the model
      this.panel.webview.postMessage({ type: 'ollama:autoConfigured', tag });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.panel.webview.postMessage({ type: 'ollama:pullDone', tag, success: false, message: msg });
    }
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
