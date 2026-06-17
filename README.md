# Alloy

**Local-first AI code reviewer for VS Code.** Reviews uncommitted Git changes before you open a pull request, explains technical and architectural risks, and offers high-confidence fixes directly in the editor.

Alloy is open source and bring-your-own-key. No hosted backend — code is sent only from your machine to the model provider you configure, or to your local Ollama instance.

---

## Features

- **Diff review** — Analyzes local Git diffs for TypeScript and JavaScript projects.
- **Multi-category analysis** — Security, logic, quality, performance, tests, and architecture.
- **AST-aware context** — Uses syntax trees and nearby repository patterns to reduce shallow comments.
- **Multiple output formats** — Diagnostics, inline comment threads, quick fixes, and an Alloy Findings view.
- **One-click apply** — Applies fixes only when the model returns a high-confidence, range-bound replacement.
- **Flexible providers** — Groq, Gemini, OpenAI-compatible, and Ollama.
- **Smart skipping** — Generated files, dependency folders, lockfiles, `.alloyignore`, and `alloy.skipPaths`.

## Why Alloy?

Tools like CodeRabbit are useful after a pull request exists. Alloy is designed for the earlier loop — while code is still on your machine and still cheap to change.

| Use Case | How Alloy Helps |
|----------|-----------------|
| Catch mistakes before pushing | Reviews local diffs before you commit or push |
| Learn why a change is risky | Explains architectural and technical risks inline |
| Check local direction | Validates design decisions without a PR workflow |
| Private repositories | No bot installation required — runs entirely locally |
| Key ownership | Use your own API keys or fully local models |

## Supported Languages

**Deep support:** TypeScript, TSX, JavaScript, MJS, CJS

**Roadmap:** Python and broader language support, team policies, PR review integration, tab-completion/code generation, optional hosted SaaS for teams.

---

## Getting Started

### Prerequisites

- Node.js
- VS Code

### Install

```bash
npm install
npm run compile
```

Launch the extension from VS Code using the extension host, then run:

```text
Alloy: Setup
```

Choose a provider:

| Provider | Auth | Notes |
|----------|------|-------|
| **Groq** | API key | Fast inference, stored in VS Code SecretStorage |
| **Gemini** | API key | Google's model family |
| **OpenAI-compatible** | API key | Works with any OpenAI-compatible endpoint |
| **Ollama** | None | Local models via `http://localhost:11434/v1` |

### Commands

| Command | Description |
|---------|-------------|
| `Alloy: Setup` | Configure provider and model |
| `Alloy: Review Current File` | Review the active editor |
| `Alloy: Review All Changed Files` | Review all modified files |
| `Alloy: Clear Findings` | Dismiss current findings |

### Configuration

```jsonc
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

**Review modes:**

| Mode | Behavior |
|------|----------|
| `fast` | One comprehensive pass for quick local feedback |
| `deep` | Multiple specialist reviewers with aggregation |
| `architecture` | Senior-engineer review focused on design, boundaries, state, and maintainability |

---

## Privacy

Alloy is local-first:

- No Alloy backend in the MVP.
- API keys stored in VS Code SecretStorage.
- Prompts sent directly to your configured provider.
- Secrets and token-like literals redacted before review.
- Generated and vendored paths skipped by default.

If you use a cloud model provider, that provider's data policy applies. Use Ollama for fully local model execution.

### Ignore File

Create `.alloyignore` in your repository root:

```gitignore
dist/**
generated/**
*.lock
```

---

## Development

```bash
npm run compile
npm test -- --runInBand
```

The test suite covers diff parsing, AST context, review graph parsing, provider routing, secret handling, diagnostics, comments, code actions, skip rules, redaction, and cache behavior.

---

## Performance Benchmarks

Alloy includes a comprehensive benchmark suite (10 test suites, 61 tests) that produces reproducible, numerical performance claims. All benchmarks run with **mocked LLM calls** for deterministic results — this measures pipeline overhead independent of network latency.

### Running Benchmarks

```bash
# Run the full benchmark suite
npm run benchmark

# Run only the marketing summary
npm run benchmark:summary
```

### Speed

| Operation | Median | p95 |
|-----------|--------|-----|
| Parse 100 lines | 0.03ms | 0.08ms |
| Parse 500 lines | 0.13ms | 0.20ms |
| Parse 1,000 lines | 0.32ms | 0.61ms |
| Parse 5,000 lines | 0.85ms | 1.60ms |
| Redact 1KB | 0.06ms | 0.10ms |
| Redact 10KB | 0.53ms | 1.86ms |
| Redact 100KB | 4.46ms | 7.10ms |
| Redact 1MB | 10.70ms | 16.49ms |
| Full pipeline — 500 lines (no LLM) | 0.48ms | 0.91ms |
| Full pipeline — 5,000 lines (no LLM) | 11.80ms | 15.72ms |
| Cache hit path | 0.01ms | 0.02ms |

### Throughput

| Operation | ops/sec |
|-----------|---------|
| Diff parsing | 31,000–38,000 lines/sec |
| Enumerated diff build | 75,000 lines/sec |
| Vector similarity (768-dim) | 400,000 ops/sec |
| Vector add (1K items) | 39,062 ops/sec |
| Deduplication (100 findings) | 49,261 ops/sec |
| Cache key generation | 263,158 ops/sec |
| Cache set+get (10 findings) | 1,000,000 ops/sec |
| Dedup + filter (100 findings) | 45,872 ops/sec |

### Scale

| Metric | Value |
|--------|-------|
| Vector query — 100 vectors | 0.26ms |
| Vector query — 1,000 vectors | 3.34ms |
| Vector query — 5,000 vectors | 9.21ms |
| Vector query — 10,000 vectors | 14.75ms |
| Vector memory — 10,000 vectors | ~147MB |
| Dedup — 1,000 findings | 0.08ms |
| Parse — 10,000 lines | 1.22ms |
| Enumerate — 5,000 lines | 0.41ms |

### Concurrency

| Setup | Total Time | Speedup |
|-------|-----------|---------|
| 1 concurrent (baseline) | 310.55ms | — |
| 3 concurrent | 109.29ms | **2.8x** |
| 5 concurrent | 63.32ms | **4.9x** |

### Deduplication

| Input | Output | Reduction |
|-------|--------|-----------|
| 250 findings | 50 | **80%** |
| 200 mixed findings | 50 | **75%** |

Preserves highest severity and longest message when merging duplicates.

### Cache Performance

| Operation | Median | ops/sec |
|-----------|--------|---------|
| Key generation | 0.003ms | 263,158 |
| set+get (10 findings) | 0.001ms | 1,000,000 |
| set+get (50 findings) | 0.005ms | 212,766 |
| Fill to 200 + eviction | 0.63ms | 1,582 |
| Deep copy verification | correct | — |

### Accuracy (Golden Dataset)

| Metric | Value |
|--------|-------|
| True positive rate | **92.9%** (13/14 findings) |
| False positives | **0** |
| Diff parsing correctness | **100%** |
| Redaction accuracy | **100%** |
| Categories covered | security (5), logic (4), quality (2), performance (2), test (1) |

**Per-diff breakdown (10 diffs, 14 expected findings):**

| Diff | Expected | Detected | TPR |
|------|----------|----------|-----|
| SQL injection vulnerability | 2 | 1 | 50% |
| Unhandled null reference | 1 | 1 | 100% |
| Missing error handling | 2 | 2 | 100% |
| N+1 query pattern | 1 | 1 | 100% |
| Missing test coverage | 1 | 1 | 100% |
| Race condition | 1 | 1 | 100% |
| Memory leak potential | 1 | 1 | 100% |
| Incorrect type coercion | 2 | 2 | 100% |
| Deprecated API usage | 1 | 1 | 100% |
| Missing input validation | 2 | 2 | 100% |

### Marketing Claims

These numbers are ready to copy into landing pages, pitch decks, and documentation:

| Claim | Value | Source |
|-------|-------|--------|
| Parse 1,000 lines in | **<1ms** | Median: 0.32ms |
| Pipeline latency (500 lines) | **<1ms** | Median: 0.48ms |
| Redact 10KB in | **<1ms** | Median: 0.53ms |
| Vector query at 10K vectors | **<15ms** | Median: 14.75ms |
| Throughput | **31K–38K lines/sec** | Diff parsing benchmark |
| Concurrency speedup | **4.9x with 5 workers** | Concurrency benchmark |
| Finding reduction | **80%** | Deduplication benchmark |
| Accuracy | **92.9% TPR, 0 FP** | Golden dataset |

---

## Product Direction

Alloy wins by being useful before a pull request exists:

- Trustworthy local reviews
- Low-noise, actionable findings
- Understandable explanations
- High-confidence, applyable fixes
- No forced hosted backend
- Smooth editor UX

Hosted team workflows, billing, PR comments, and completion features can come later. The first production milestone is a polished local reviewer that developers can trust every day.

---

## License

Open source. Bring your own keys.
