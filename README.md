# Alloy

Alloy is a local-first AI code reviewer for VS Code. It reviews your uncommitted Git changes before you open a pull request, explains technical and architectural risks, and can offer high-confidence fixes directly in the editor.

The MVP is open source and bring-your-own-key. Alloy does not run a hosted backend: code is sent only from your machine to the model provider you configure, or to your local Ollama instance.

## What Alloy Does

- Reviews local Git diffs for TypeScript and JavaScript projects.
- Focuses on security, logic, quality, performance, tests, and architecture.
- Uses AST context and nearby repository patterns to reduce shallow comments.
- Shows findings as diagnostics, inline comment threads, quick fixes, and an Alloy Findings view.
- Offers one-click apply only when the model returns a high-confidence, range-bound replacement.
- Supports Groq, Gemini, OpenAI-compatible providers, and Ollama.
- Skips generated files, dependency folders, lockfiles, `.alloyignore`, and `alloy.skipPaths`.

## Why Not Just PR Review?

Tools like CodeRabbit are useful after a pull request exists. Alloy is designed for the earlier loop: while code is still on your machine and still cheap to change.

That makes Alloy useful for:

- catching mistakes before pushing,
- learning why a change is risky,
- checking local architectural direction,
- reviewing work in private repositories without installing a bot,
- using your own API keys or local models.

## Current MVP Scope

Deep support:

- TypeScript
- TSX
- JavaScript
- MJS
- CJS

Roadmap:

- Python and broader language support
- team policies
- PR review integration
- tab-completion/code generation
- optional hosted SaaS for teams

## Setup

1. Install dependencies:

```bash
npm install
```

2. Compile:

```bash
npm run compile
```

3. Launch the extension from VS Code using the extension host.

4. Run:

```text
Alloy: Setup
```

Choose one provider:

- Groq
- Gemini
- OpenAI-compatible
- Ollama

For cloud providers, Alloy stores your API key in VS Code SecretStorage. For Ollama, use an OpenAI-compatible local endpoint such as `http://localhost:11434/v1`.

## Commands

- `Alloy: Setup`
- `Alloy: Review Current File`
- `Alloy: Review All Changed Files`
- `Alloy: Clear Findings`

The legacy command `ReviewBot: Review Current File` remains as a temporary compatibility alias.

## Configuration

```json
{
  "alloy.reviewOnSave": true,
  "alloy.provider": "groq",
  "alloy.model": "",
  "alloy.reviewMode": "fast",
  "alloy.maxDiffLines": 600,
  "alloy.maxFilesPerReview": 12,
  "alloy.skipPaths": [],
  "alloy.enabledCategories": ["security", "logic", "quality", "performance", "test"],
  "alloy.enabledSeverities": ["error", "warning", "info"],
  "alloy.debounceMs": 2000
}
```

Review modes:

- `fast`: one comprehensive pass for quick local feedback.
- `deep`: multiple specialist reviewers with aggregation.
- `architecture`: senior-engineer review focused on design, boundaries, state, and maintainability.

## Privacy Model

Alloy is local-first:

- No Alloy backend is used in the MVP.
- API keys are stored in VS Code SecretStorage.
- Prompts are sent directly to your configured provider.
- Common secrets and large token-like literals are redacted before review.
- Generated and vendored paths are skipped by default.

If you use a cloud model provider, that provider's data policy still applies. Use Ollama for fully local model execution.

## Ignore File

Create `.alloyignore` in your repository root:

```gitignore
dist/**
generated/**
*.lock
```

## Development

```bash
npm run compile
npm test -- --runInBand
```

The test suite covers diff parsing, AST context, review graph parsing, provider routing, secret handling, diagnostics, comments, code actions, skip rules, redaction, and cache behavior.

## Product Direction

Alloy should win by being useful before a pull request exists:

- trustworthy local reviews,
- low-noise actionable findings,
- understandable explanations,
- high-confidence applyable fixes,
- no forced hosted backend,
- smooth editor UX.

Hosted team workflows, billing, PR comments, and completion features can come later. The first production milestone is a polished local reviewer that developers can trust every day.
