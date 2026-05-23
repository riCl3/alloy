# AI Code Review Agent — Complete Technical & Architectural Documentation

> **Purpose of this document:** Full product specification, architecture decisions, data contracts, component interactions, technology choices with justifications, and implementation flow. Written so an AI agent can implement each section step by step without ambiguity.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [What We Are NOT Building](#2-what-we-are-not-building)
3. [System Architecture — Bird's Eye View](#3-system-architecture---birds-eye-view)
4. [Entry Point A — Pre-Commit Hook (CLI Tool)](#4-entry-point-a---pre-commit-hook-cli-tool)
5. [Entry Point B — GitHub App (PR Reviewer)](#5-entry-point-b---github-app-pr-reviewer)
6. [Shared Component 1 — Diff Extractor](#6-shared-component-1---diff-extractor)
7. [Shared Component 2 — Context Builder](#7-shared-component-2---context-builder)
8. [Shared Component 3 — AST Parser & Call Graph Builder](#8-shared-component-3---ast-parser--call-graph-builder)
9. [Shared Component 4 — Repo Style Indexer](#9-shared-component-4---repo-style-indexer)
10. [Core Pipeline — LangGraph Multi-Agent System](#10-core-pipeline---langgraph-multi-agent-system)
11. [Agent Node Specifications](#11-agent-node-specifications)
12. [LLM Router — Free Tier Strategy](#12-llm-router---free-tier-strategy)
13. [Output Layer](#13-output-layer)
14. [GitHub App Infrastructure](#14-github-app-infrastructure)
15. [Data Models & Contracts](#15-data-models--contracts)
16. [Repository Structure](#16-repository-structure)
17. [Technology Stack with Justifications](#17-technology-stack-with-justifications)
18. [Environment Configuration](#18-environment-configuration)
19. [Installation & Setup Flow](#19-installation--setup-flow)
20. [Interview Talking Points — Architecture Decisions](#20-interview-talking-points---architecture-decisions)

---

## 1. Product Overview

### What this is

An open-source AI-powered code review system with two distinct surfaces:

**Surface 1 — Pre-commit CLI tool**
Runs locally on a developer's machine. Intercepts every `git commit`, reviews only the staged diff, and prints findings in the terminal before the commit is created. Can block commits with HIGH severity issues. Uses a local LLM via Ollama — no API calls, no cost, no network dependency.

**Surface 2 — GitHub App**
A cloud-hosted service installed on a GitHub repository. Triggered by PR events (opened, new commits pushed, reopened). Performs a deep review with full codebase context — not just the diff. Posts inline comments on specific changed lines via the GitHub Review API. Understands the entire call graph of changed functions, not just the lines that changed.

### The core differentiation from CodeRabbit and similar tools

| Feature | CodeRabbit | This project |
|---|---|---|
| Pre-commit (before push) | No | Yes |
| Understands full call graph | No | Yes (AST-based) |
| Repo-specific style learning | Partial | Yes (vector index of existing codebase) |
| Self-hostable | No | Yes (Docker + any VPS) |
| Free | No (paid) | Yes (free tier LLMs) |
| Open source | No | Yes |
| Works offline | No | Yes (pre-commit via Ollama) |

### Who uses this

- Individual developers who want pre-push feedback before embarrassing themselves in code review
- Small teams that want automated PR review without paying for CodeRabbit
- Companies that cannot send code to external APIs (compliance) — they self-host and use Ollama

---

## 2. What We Are NOT Building

To keep scope clear for the AI agent implementing this:

- No web dashboard or UI (output is terminal + GitHub comments only)
- No support for non-Git version control (SVN, Mercurial)
- No auto-fix/auto-commit of suggestions (review only, no changes to code)
- No support for binary files, images, or non-text assets
- No real-time editor plugin (VS Code extension is a future V2 feature)
- No fine-tuned model (we use prompting + RAG, not fine-tuning)
- No database (state is in-memory per review run; repo index uses ChromaDB local files)

---

## 3. System Architecture — Bird's Eye View

```
┌─────────────────────────────────────────────────────────────────┐
│                        ENTRY POINTS                             │
│                                                                 │
│  [git commit]                          [GitHub PR event]        │
│       │                                        │                │
│  Pre-commit hook                       GitHub webhook           │
│  (local, Python)                       (FastAPI server)         │
└──────────┬─────────────────────────────────────┬────────────────┘
           │                                     │
           ▼                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SHARED INGESTION LAYER                       │
│                                                                 │
│  Diff Extractor → Context Builder → AST Parser                  │
│                          │                                      │
│                   Repo Style Indexer                            │
│                   (ChromaDB, populated on first install)        │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼ ReviewState object
┌─────────────────────────────────────────────────────────────────┐
│                  LANGGRAPH PIPELINE                             │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │Logic Reviewer│  │Sec. Scanner  │  │Performance Reviewer  │  │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                │                      │               │
│  ┌──────┴──────┐  ┌──────┴───────┐              │               │
│  │Style Checker│  │Test Analyst  │              │               │
│  └──────┬──────┘  └──────┬───────┘              │               │
│         └────────────────┴──────────────────────┘               │
│                           │                                     │
│                    ┌──────▼──────┐                              │
│                    │ Aggregator  │                              │
│                    └──────┬──────┘                              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
           ┌───────────────┴───────────────┐
           │                               │
           ▼                               ▼
   Terminal Output                 GitHub API Output
   (pre-commit mode)               (PR comment mode)
```

### Key architectural principle: shared state, not shared code paths

Both entry points produce the exact same `ReviewState` object and feed it into the exact same LangGraph pipeline. The only difference is:
- How the diff is extracted (git CLI vs GitHub API)
- How the output is rendered (terminal vs GitHub Review API)
- Which LLM is used (Ollama local vs Groq/Gemini cloud)

This means the review logic is tested once and works everywhere.

---

## 4. Entry Point A — Pre-Commit Hook (CLI Tool)

### Installation mechanism

When a developer runs `pip install reviewbot-cli`, the package's `post-install` script writes a Python-calling shell script into `.git/hooks/pre-commit` of the current directory.

```
Install flow:
pip install reviewbot-cli
    → runs post_install() in setup.py
    → writes .git/hooks/pre-commit
    → chmod +x .git/hooks/pre-commit
    → done
```

The hook file written to `.git/hooks/pre-commit`:
```bash
#!/bin/bash
python -m reviewbot.precommit "$@"
exit $?
```

### Pre-commit execution flow

```
git commit triggered
    │
    ├── Hook script fires
    │
    ├── reviewbot/precommit.py::main()
    │       │
    │       ├── extract_staged_diff()         ← git diff --cached --unified=5
    │       │       Returns: list[FileDiff]
    │       │
    │       ├── Check: diff is empty? → exit 0 (nothing to review)
    │       │
    │       ├── build_context(diff, mode="precommit")
    │       │       Returns: ReviewState (partially populated)
    │       │
    │       ├── run_pipeline(state, provider="ollama")
    │       │       Returns: ReviewState (fully populated)
    │       │
    │       ├── print_terminal_report(state.final_findings)
    │       │       Prints: colored output, grouped by severity
    │       │
    │       └── Count HIGH findings
    │               HIGH > 0 → sys.exit(1) → commit blocked
    │               HIGH == 0 → sys.exit(0) → commit proceeds
    │
    └── git either creates commit or aborts
```

### Pre-commit configuration file

Developers can configure behavior via `.reviewbot.yml` in their repo root:

```yaml
# .reviewbot.yml
precommit:
  block_on: ["HIGH"]           # Which severities block the commit
  warn_on: ["MEDIUM", "LOW"]   # Which severities show warnings but allow commit
  skip_paths:                  # Glob patterns to never review
    - "tests/**"
    - "migrations/**"
    - "*.lock"
  max_diff_lines: 500          # Skip review if diff is larger (too big = slow)
  model: "codellama:13b"       # Ollama model to use

github_app:
  skip_paths:
    - "*.md"
    - "*.txt"
  post_summary: true           # Post a summary comment on the PR
  post_inline: true            # Post inline line comments
```

---

## 5. Entry Point B — GitHub App (PR Reviewer)

### What a GitHub App is

A GitHub App is an OAuth application that:
1. Registers with GitHub (you give it a name, webhook URL, permissions)
2. Gets installed on repositories by repo owners
3. Receives webhook events (JSON payloads) at the webhook URL you registered
4. Uses a private key + JWT to authenticate and call the GitHub API on behalf of the installation

Your webhook URL is the FastAPI server you deploy on a VPS/EC2.

### Webhook event flow

```
Developer opens PR / pushes commit to PR branch
    │
    ├── GitHub sends POST request to your webhook URL
    │       Headers: X-GitHub-Event: pull_request
    │       Body: JSON with full PR metadata
    │
    ├── FastAPI endpoint: POST /webhook
    │       │
    │       ├── Verify webhook signature (HMAC-SHA256 using webhook secret)
    │       │       Invalid signature → 403, discard
    │       │
    │       ├── Check event action: "opened" | "synchronize" | "reopened"
    │       │       Other actions (closed, labeled, etc.) → 200, ignore
    │       │
    │       ├── Enqueue job to Redis queue (BullMQ equivalent: ARQ in Python)
    │       │       Return 200 immediately ← GitHub requires response within 10s
    │       │
    │       └── Worker picks up job from queue
    │               Runs full review pipeline
    │               Posts results to GitHub API
    │
    └── GitHub displays inline comments on PR
```

### Why queue the job instead of running inline

GitHub requires your webhook endpoint to respond within 10 seconds or it marks the delivery as failed. A full review pipeline takes 30–120 seconds. So you:
1. Receive webhook → enqueue job → respond 200 immediately
2. Worker process picks up the job and runs the review asynchronously
3. Results are posted to GitHub whenever they're ready

This is the same pattern you used in your Queuebit project (BullMQ + Redis). Here you use Python's `ARQ` library (Redis-backed async job queue) instead of BullMQ, but the concept is identical.

### GitHub API calls made during review

```
Authentication:
  1. Generate JWT from your GitHub App private key
  2. Exchange JWT for installation access token (scoped to the repo)
  3. Use installation token for all subsequent calls

Data fetching:
  GET /repos/{owner}/{repo}/pulls/{pr_number}/files
      → List of files changed with patch (diff)

  GET /repos/{owner}/{repo}/contents/{path}?ref={base_branch}
      → Full file content for context building (AST parsing)

  GET /repos/{owner}/{repo}/pulls/{pr_number}
      → PR description, title, linked issue

Posting results:
  POST /repos/{owner}/{repo}/pulls/{pr_number}/reviews
      Body: {
        "commit_id": "abc123",     ← latest commit SHA on the PR branch
        "event": "COMMENT",        ← COMMENT | REQUEST_CHANGES | APPROVE
        "body": "Summary here",    ← top-level PR comment
        "comments": [              ← inline line comments
          {
            "path": "src/auth.py",
            "line": 42,
            "body": "SQL injection risk: use parameterized queries."
          }
        ]
      }
```

---

## 6. Shared Component 1 — Diff Extractor

### Responsibility

Convert raw git diff output (or GitHub API patch format) into structured `FileDiff` objects that every downstream component can work with.

### Two modes

**Mode: precommit**
Source: `git diff --cached --unified=5`
This gets only staged changes (what's been `git add`-ed), not all working directory changes.

**Mode: github_pr**
Source: GitHub API `/pulls/{pr}/files` response
GitHub returns patch data per file in the same unified diff format.

### Unified diff format (what you're parsing)

```
--- a/src/auth/token.py
+++ b/src/auth/token.py
@@ -38,7 +38,9 @@ class TokenValidator:
     def validate(self, token: str) -> bool:
-        query = f"SELECT * FROM tokens WHERE value = '{token}'"
-        return self.db.execute(query).rowcount > 0
+        query = "SELECT * FROM tokens WHERE value = ?"
+        return self.db.execute(query, (token,)).rowcount > 0
+
+    def revoke(self, token: str) -> None:
+        self.db.execute("DELETE FROM tokens WHERE value = ?", (token,))
```

### Library used: `unidiff`

Do not write a custom diff parser. The `unidiff` Python library handles all edge cases (binary files, renames, mode changes, no newline at EOF). Install: `pip install unidiff`.

### Output structure

```
FileDiff {
    path: "src/auth/token.py"
    language: "python"             ← inferred from extension
    added_lines: [(40, "        query = \"SELECT...\"")]
    removed_lines: [(39, "        query = f\"SELECT...\"")]
    raw_diff: "--- a/src/auth/token.py\n+++ b/src/auth/token.py\n..."
    is_new_file: false
    is_deleted_file: false
    is_rename: false
}
```

### Language detection

Map file extensions to language strings. This drives which AST parser to use and which LLM prompt template to apply.

```
.py → python
.js, .mjs, .cjs → javascript
.ts, .tsx → typescript
.java → java
.go → go
.rs → rust
.rb → ruby
.php → php
.cs → csharp
.cpp, .cc, .cxx → cpp
.c → c
.kt → kotlin
.swift → swift
```

Files with no matching extension are skipped (not reviewed).

---

## 7. Shared Component 2 — Context Builder

### Responsibility

Takes a list of `FileDiff` objects and builds the full `ReviewState` — including fetching full file contents, retrieving related files (callers/callees), and querying the repo style index.

### What "context" means and why it matters

Naive code review: send the diff to an LLM. Problem: the LLM sees line 42 changed but doesn't know what line 42's function is supposed to do, who calls it, or what the function signature contract is. It reviews in a vacuum.

Proper context: before sending to the LLM, you also send:
- The full file that was changed (not just the changed lines)
- The function signatures of everything that calls the changed function
- The test file for this module (if it exists)
- The PR description (what was the developer trying to do?)
- Relevant patterns from the rest of the codebase

### Context building steps

```
For each FileDiff:

Step 1 — Full file content
    precommit mode: read from disk (os.path.join(repo_root, file.path))
    github mode: GET /repos/{owner}/{repo}/contents/{path}?ref={head_sha}

Step 2 — AST parsing
    Call AST Parser with full file content
    Returns: list of function names that changed, their signatures

Step 3 — Find callers
    Search the rest of the codebase for calls to changed functions
    Collect caller function signatures (not full bodies — too much context)
    Limit: top 5 callers by frequency

Step 4 — Test file lookup
    Look for test file using naming conventions:
        src/auth/token.py → tests/auth/test_token.py
        src/auth/token.py → tests/test_token.py
        src/auth/token.py → src/auth/token.test.py (JS convention)
    If found: include full test file content

Step 5 — Style context retrieval
    Query ChromaDB repo style index
    Query string: [changed function signatures + file path]
    Returns: top 3 most similar existing functions from the codebase
    Purpose: "here's how this codebase handles similar patterns"

Step 6 — Assemble ReviewState
    Populate all fields
    Estimate token count
    If over 8000 tokens: truncate test file first, then callers, then full file
```

### Token budget management

Every LLM has a context window limit. You must manage this explicitly.

```
Token budget: 6000 tokens for context (leaves 2000 for LLM response)

Priority order (drop lowest priority first if over budget):
1. The diff itself (never drop — this is what's being reviewed)
2. Full content of changed file (truncate to relevant class/function if needed)
3. PR description (keep — critical for logic review)
4. Test file content (drop first if tight)
5. Caller signatures (drop second if tight)
6. Style context from ChromaDB (drop last resort)
```

Use `tiktoken` library to count tokens: `pip install tiktoken`

---

## 8. Shared Component 3 — AST Parser & Call Graph Builder

### Why AST parsing and not text search

Text search (grep/regex) for function calls is unreliable:
- `validate(token)` matches strings, comments, variable names named `validate`
- Cannot distinguish method calls from function calls
- Cannot understand aliased imports (`from auth import validate as v; v(token)`)

AST parsing works at the language grammar level — you get the actual structure of the code, not just text patterns.

### Library used: `tree-sitter`

`tree-sitter` is a parser generator that supports 50+ languages with a single Python API. It's what GitHub Copilot, Sourcegraph, and most professional code tools use internally.

```
pip install tree-sitter
pip install tree-sitter-python tree-sitter-javascript tree-sitter-typescript
pip install tree-sitter-java tree-sitter-go tree-sitter-rust
```

### What the AST parser extracts

Given a full source file and a list of changed line numbers:

```
Output: ASTContext {
    changed_functions: ["TokenValidator.validate", "TokenValidator.revoke"]

    function_signatures: {
        "TokenValidator.validate": "def validate(self, token: str) -> bool",
        "TokenValidator.revoke": "def revoke(self, token: str) -> None"
    }

    callers: [
        {
            "caller_function": "AuthMiddleware.authenticate",
            "file": "src/middleware/auth.py",
            "line": 67,
            "signature": "def authenticate(self, request: Request) -> Optional[User]"
        }
    ]

    imports_in_changed_file: [
        "from src.db import Database",
        "from typing import Optional"
    ]

    class_context: "class TokenValidator:"  ← parent class of changed functions

    call_graph_snippet: "AuthMiddleware.authenticate → TokenValidator.validate → Database.execute"
}
```

### Tree-sitter query examples (Python grammar)

Tree-sitter uses a query language similar to pattern matching. To find all function definitions:

```scheme
(function_definition
  name: (identifier) @function.name
  parameters: (parameters) @function.params
  return_type: (type) @function.return_type)
```

To find all calls to a specific function named "validate":

```scheme
(call
  function: (attribute
    attribute: (identifier) @call.name)
  (#eq? @call.name "validate"))
```

The AI agent should implement these queries for Python first, then JavaScript/TypeScript, as those cover 80% of real codebases.

### Call graph construction

```
Algorithm:
1. Parse all .py files in the repo into ASTs (do this once, cache results)
2. For each file: extract all function calls with their locations
3. Build a dict: {function_name: [list of callers]}
4. When a diff changes function X: look up X in the dict to find callers
5. Return top 5 callers sorted by: (same file first, then by call frequency)

Caching:
- Cache parsed ASTs in a local SQLite database keyed by (file_path, file_mtime)
- On subsequent runs: only re-parse files that have changed (mtime check)
- This makes subsequent reviews fast (<100ms for call graph lookup)
```

---

## 9. Shared Component 4 — Repo Style Indexer

### What this does

On first install, it reads the entire existing codebase, extracts patterns (how errors are handled, how functions are structured, naming conventions, common abstractions), and stores vector embeddings in a local ChromaDB database.

When reviewing a new change, it retrieves the 3 most similar existing patterns from the codebase. This lets the Style Checker agent say "in this codebase, database errors are always wrapped in a `DatabaseException`, but your new function lets them propagate as raw `sqlite3.Error`" — something no generic linter can do.

### Library used: ChromaDB

ChromaDB is an open-source vector database that runs locally as a Python library with no external server required. Data is stored in a local directory.

```
pip install chromadb
```

### Indexing flow

```
reviewbot init   ← developer runs this once after installing

    │
    ├── Walk entire repo (respecting .gitignore)
    │
    ├── For each source file:
    │       Parse with tree-sitter
    │       Extract each function as a document:
    │           {
    │               "id": "src/auth/token.py::TokenValidator.validate",
    │               "content": "<full function body>",
    │               "metadata": {
    │                   "file": "src/auth/token.py",
    │                   "function": "TokenValidator.validate",
    │                   "language": "python",
    │                   "has_error_handling": true,
    │                   "has_type_hints": true,
    │                   "lines": 12
    │               }
    │           }
    │
    ├── Embed all documents using:
    │       all-MiniLM-L6-v2 via sentence-transformers (local, free, fast)
    │       pip install sentence-transformers
    │
    ├── Store in ChromaDB collection: "repo_style_index"
    │       Located at: .reviewbot/chroma_db/
    │
    └── Done. Future reviews query this index.
```

### Why sentence-transformers and not OpenAI embeddings

OpenAI embeddings cost money and require network. `all-MiniLM-L6-v2` is a 22MB model that runs in ~5ms per embedding on CPU. For code retrieval tasks (semantic similarity of code patterns), it performs comparably. Zero cost, works offline.

### Retrieval query

When reviewing a changed function:
```
Query: "<function signature> <first 5 lines of function body>"
Top K: 3
Filter: metadata.language == current_file_language
Returns: 3 most similar existing functions with their full bodies
```

---

## 10. Core Pipeline — LangGraph Multi-Agent System

### Why LangGraph and not a single LLM call

A single LLM call reviewing all aspects of code simultaneously:
- Produces generic, unfocused output
- Cannot specialize prompts per concern (security needs different framing than style)
- Cannot parallelize (slower)
- Cannot add conditional logic (e.g., "only run security scan if the diff touches auth files")

LangGraph models the review as a state machine where each node is a specialized agent with its own prompt, its own concerns, and its own section of the output. The state flows through the graph and each node adds its findings.

### LangGraph concepts used in this project

**State**: A Pydantic model (`ReviewState`) passed between all nodes. Each node reads the full state and writes only its own findings field.

**Nodes**: Python async functions that take `ReviewState` and return updated `ReviewState`.

**Edges**: Define which nodes run after which. In this project, the 5 review agents run in parallel (fan-out), then merge at the aggregator (fan-in).

**Checkpointer**: LangGraph's built-in memory mechanism. Saves state at each node. Allows resuming interrupted reviews.

### Graph topology

```
                 START
                   │
              [Context node]
                   │
    ┌──────┬────────┼────────┬──────┐
    │      │        │        │      │
[Logic] [Sec.] [Perf.] [Style] [Test]   ← parallel fan-out
    │      │        │        │      │
    └──────┴────────┼────────┴──────┘
                    │
              [Aggregator]
                    │
                  END
```

### Why parallel and not sequential

If run sequentially (logic → security → performance → style → test), total latency = sum of all LLM call times. At ~3s per call on Groq, that's 15 seconds.

With parallel fan-out, all 5 agents run simultaneously. Total latency = slowest single agent ≈ 3–5 seconds.

LangGraph supports this via `send()` API and conditional parallel edges.

### State checkpoint strategy

```
After each node completes, LangGraph saves state to:
    .reviewbot/checkpoints/{review_id}.json

If a review is interrupted (network error, timeout):
    On retry: load checkpoint, skip completed nodes, resume from last checkpoint
    This prevents re-running expensive LLM calls for nodes that already completed
```

---

## 11. Agent Node Specifications

### Node 0 — Context Node (pre-processing, no LLM call)

Runs before all review agents. Validates the state, computes token budget, truncates context if needed.

```
Input: ReviewState (with diffs, ast_context, raw context)
Output: ReviewState (with context trimmed to token budget)
No LLM call. Pure Python.
```

### Node 1 — Logic Reviewer

**What it checks:**
- Does the changed code actually do what the PR description says it should?
- Are there off-by-one errors, incorrect boundary conditions?
- Are there unreachable code paths?
- Do function signatures match how they're called by callers?
- Are return types consistent with the declared signature?
- Are there null/None dereference risks?

**Prompt strategy:**
System prompt frames the agent as a senior engineer doing logic verification. Provides: the diff, the PR description, the caller signatures (so it knows the contract), the full function body.

**Key instruction in prompt:**
"You are reviewing ONLY for logic correctness. Do not comment on security, performance, or style. Focus exclusively on: does this code do what it claims to do?"

**Output:** Populates `state.logic_findings` with `ReviewFinding` objects.

### Node 2 — Security Scanner

**What it checks:**
- SQL injection (string interpolation in queries)
- Command injection (`os.system`, `subprocess` with shell=True and user input)
- Path traversal (user input used in file paths without sanitization)
- Hardcoded secrets (API keys, passwords, tokens in code)
- Insecure deserialization (`pickle.loads` with untrusted data, `yaml.load` without Loader)
- Broken authentication patterns
- Missing authorization checks
- Exposed sensitive data in logs
- SSRF (user-controlled URLs passed to HTTP clients)
- Regex denial of service (catastrophic backtracking patterns)

**Prompt strategy:**
System prompt frames agent as a security engineer doing threat modeling. Provides OWASP Top 10 as reference in the system prompt. Asks to reason about attacker intent — what could go wrong if this code is exploited?

**Key instruction:**
"For each finding, explain the attack vector — how would a malicious actor exploit this? If you cannot articulate the attack, it is not a security finding."

**Output:** Populates `state.security_findings`.

### Node 3 — Performance Reviewer

**What it checks:**
- N+1 query problems (loop containing database calls)
- Blocking I/O in async functions (`time.sleep` in async def, synchronous DB calls in async context)
- Unnecessary repeated computation (same calculation inside a loop)
- Missing database indexes implied by query patterns
- Large data structures loaded fully into memory when streaming would work
- Inefficient string concatenation in loops (use join instead)
- Missing caching for expensive, pure computations

**Prompt strategy:**
System prompt frames agent as a performance engineer who has profiled production systems. Asks to estimate order-of-magnitude impact: is this O(n²) where n could be large? Is this an extra DB round-trip per request?

**Key instruction:**
"Only flag issues that would be measurably slow at realistic production scale (>1000 users or >10000 records). Do not flag micro-optimizations."

**Output:** Populates `state.performance_findings`.

### Node 4 — Style Checker

**What it checks (using repo style context from ChromaDB):**
- Does error handling match the pattern used in the rest of this codebase?
- Are new abstractions consistent with existing ones (naming, structure)?
- Are there magic numbers/strings that should be constants?
- Are function names consistent with the codebase's naming conventions?
- Is the level of abstraction consistent with similar functions in this codebase?

**Prompt strategy:**
System prompt provides 3 similar existing functions from ChromaDB. "Here is how this codebase handles similar patterns. Review the new code for consistency with these patterns."

**Key instruction:**
"You are enforcing codebase consistency, not generic clean code principles. If this codebase uses a pattern that differs from general best practice, flag deviations from the codebase pattern, not from best practice."

**Output:** Populates `state.style_findings`.

### Node 5 — Test Analyst

**What it checks:**
- What edge cases are NOT covered by the existing tests?
- Are there input combinations that could cause unexpected behavior and are not tested?
- If a new function was added, is there a corresponding test?
- Are mocks realistic? (Mocking the wrong level of abstraction)
- Are tests testing implementation details rather than behavior?

**Prompt strategy:**
Provides: the changed function, the existing test file (if found). "Here is what is tested. What is not tested that should be?"

**Key instruction:**
"For each gap, write the test case description (not the code) that would cover it. One sentence per missing test."

**Output:** Populates `state.test_findings`.

### Node 6 — Aggregator (post-processing, minimal LLM call)

**What it does:**
1. Merges all findings from all 5 agents
2. Deduplicates: if Logic and Security both flagged the same line for overlapping reasons, merge into one finding
3. Re-ranks by severity: HIGH → MEDIUM → LOW → INFO
4. Generates a 3-sentence summary of the overall review
5. Assigns an overall review decision: APPROVE / REQUEST_CHANGES / COMMENT

**Deduplication logic:**
Two findings are duplicates if: same file, line numbers within 3 of each other, and semantic similarity of their messages > 0.85 (computed using sentence-transformers cosine similarity — no LLM call needed).

**Output:** Populates `state.final_findings` and `state.summary`.

---

## 12. LLM Router — Free Tier Strategy

### The routing problem

Different review contexts need different models:
- Pre-commit (local): must work offline → Ollama only
- PR review (cloud): can use APIs → prefer fast free tiers

### Router configuration

```python
PROVIDER_PRIORITY = {
    "precommit": ["ollama"],
    "github_pr": ["groq", "gemini", "ollama"]  # fallback order
}

MODEL_MAP = {
    "ollama": {
        "code": "codellama:13b",    # specialized for code
        "general": "llama3.1:8b"   # fallback
    },
    "groq": {
        "code": "llama-3.1-70b-versatile",   # best free model on Groq
        "fast": "llama-3.1-8b-instant"        # for less critical nodes
    },
    "gemini": {
        "code": "gemini-1.5-flash",  # 1M context, free tier
        "long": "gemini-1.5-flash"   # for large files
    }
}
```

### Per-node model assignment

Not all nodes need the strongest model:

```
Logic Reviewer → groq/llama-3.1-70b   (reasoning-heavy, use best)
Security Scanner → groq/llama-3.1-70b  (high stakes, use best)
Performance Reviewer → groq/llama-3.1-8b (pattern recognition, fast model ok)
Style Checker → groq/llama-3.1-8b      (simple comparison task)
Test Analyst → groq/llama-3.1-8b       (straightforward gap analysis)
Aggregator → no LLM (pure Python dedup + sentence-transformers for similarity)
```

### Rate limit handling

Groq free tier: 14,400 requests/day, 500,000 tokens/minute.
Gemini free tier: 1,500 requests/day on Flash.

```
On rate limit error (HTTP 429):
    1. Wait for retry-after header value
    2. If retry-after > 30s: switch to next provider in fallback chain
    3. If all cloud providers rate limited: fall back to Ollama (if available)
    4. If Ollama not available: queue the review with 5-minute retry
```

### Response caching

Many PRs review the same utility functions repeatedly. Cache LLM responses:

```
Cache key: SHA256(model_name + prompt_text)
Cache store: Redis (in cloud) / local SQLite (pre-commit)
TTL: 24 hours
Cache hit rate in practice: ~30-40% (common patterns appear frequently)
Cost saving: significant on Groq rate limits
```

---

## 13. Output Layer

### Terminal output (pre-commit mode)

```
ReviewBot — Pre-commit Review
─────────────────────────────────────────────────────

src/auth/token.py

  [HIGH] Line 39 — Security
  SQL injection vulnerability: string interpolation used in query
  Fix: use parameterized query — db.execute("SELECT...", (token,))

  [MEDIUM] Line 52 — Performance
  Database call inside loop (lines 48-55). At scale this is O(n) queries.
  Fix: fetch all tokens in a single query before the loop.

  [LOW] Line 61 — Style
  Error handling here uses bare `except:` — this codebase uses
  `except DatabaseException as e:` (see src/users/repository.py:88)

─────────────────────────────────────────────────────
  1 HIGH · 1 MEDIUM · 1 LOW
  ❌ Commit blocked. Fix HIGH issues or use --no-verify to skip.
```

Format rules:
- Color: HIGH = red, MEDIUM = yellow, LOW = cyan, INFO = white
- Use `colorama` library for cross-platform terminal colors
- Always show file path as a header before findings for that file
- Always show the fix suggestion, not just the problem

### GitHub PR output (github_app mode)

Two types of output are posted:

**Type 1 — Inline line comment** (posted on the specific changed line)
```
🔴 **Security — HIGH**

SQL injection vulnerability detected. The `token` variable is interpolated directly into the SQL string, allowing an attacker to modify the query structure.

**Attack vector:** `token = "' OR '1'='1"` would return all rows.

**Fix:**
```python
query = "SELECT * FROM tokens WHERE value = ?"
return self.db.execute(query, (token,)).rowcount > 0
```
```

**Type 2 — PR summary comment** (posted as a top-level comment on the PR)
```
## ReviewBot Summary

Reviewed 3 files · 47 changed lines

**Overall: REQUEST CHANGES**

| Severity | Count |
|---|---|
| 🔴 HIGH | 1 |
| 🟡 MEDIUM | 2 |
| 🔵 LOW | 3 |

**Critical issue:** SQL injection in `src/auth/token.py:39`.
Authentication bypass is possible via crafted token strings.
Fix the parameterized query before merging.

---
*Reviewed by [ReviewBot](https://github.com/your-repo) · powered by Llama 3.1*
```

### GitHub Review API — event types

When posting via `POST /repos/{owner}/{repo}/pulls/{pr}/reviews`:

- `"event": "APPROVE"` — if zero HIGH/MEDIUM findings
- `"event": "REQUEST_CHANGES"` — if any HIGH findings exist
- `"event": "COMMENT"` — if only MEDIUM/LOW findings (informational, not blocking)

---

## 14. GitHub App Infrastructure

### Server components

```
reviewbot-server/
│
├── FastAPI application (main.py)
│       Handles: /webhook, /health, /install
│
├── ARQ worker (worker.py)
│       Picks up: review jobs from Redis queue
│       Runs: full LangGraph pipeline
│       Posts: results to GitHub API
│
├── Redis
│       Stores: job queue, LLM response cache, rate limit counters
│
└── ChromaDB
        Stores: repo style indexes per installation
        Location: /data/chroma/{installation_id}/
```

### Deployment

Deploy on any VPS (DigitalOcean, Hetzner, AWS EC2) using Docker Compose.

```yaml
# docker-compose.yml
version: "3.8"
services:
  api:
    build: .
    ports:
      - "8000:8000"
    environment:
      - GITHUB_APP_ID=${GITHUB_APP_ID}
      - GITHUB_PRIVATE_KEY=${GITHUB_PRIVATE_KEY}
      - GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis
    volumes:
      - chroma_data:/data/chroma

  worker:
    build: .
    command: python -m reviewbot.worker
    environment:
      - REDIS_URL=redis://redis:6379
      - GROQ_API_KEY=${GROQ_API_KEY}
      - GEMINI_API_KEY=${GEMINI_API_KEY}
    depends_on:
      - redis
    volumes:
      - chroma_data:/data/chroma

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  redis_data:
  chroma_data:
```

You already know this stack from your SuperAlign work (Proxmox + Coolify). Deploy using Coolify on the same self-hosted server.

### Webhook signature verification

GitHub signs every webhook payload with HMAC-SHA256 using your webhook secret. You must verify this before processing any payload — otherwise anyone can send fake webhook events to your server.

```python
import hmac
import hashlib

def verify_webhook_signature(payload_body: bytes, signature_header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode(), payload_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

`hmac.compare_digest` uses constant-time comparison to prevent timing attacks.

---

## 15. Data Models & Contracts

### Complete Pydantic models

```python
# reviewbot/models.py

from pydantic import BaseModel, Field
from typing import Optional, Literal
from enum import Enum

class Language(str, Enum):
    PYTHON = "python"
    JAVASCRIPT = "javascript"
    TYPESCRIPT = "typescript"
    JAVA = "java"
    GO = "go"
    RUST = "rust"
    KOTLIN = "kotlin"
    UNKNOWN = "unknown"

class Severity(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    INFO = "INFO"

class Category(str, Enum):
    LOGIC = "logic"
    SECURITY = "security"
    PERFORMANCE = "performance"
    STYLE = "style"
    TEST = "test"

class FileDiff(BaseModel):
    path: str
    language: Language
    added_lines: list[tuple[int, str]]
    removed_lines: list[tuple[int, str]]
    raw_diff: str
    is_new_file: bool = False
    is_deleted_file: bool = False
    is_rename: bool = False
    old_path: Optional[str] = None

class FunctionInfo(BaseModel):
    name: str
    signature: str
    file: str
    line_start: int
    line_end: int
    class_name: Optional[str] = None

class CallerInfo(BaseModel):
    caller_function: str
    file: str
    line: int
    signature: str

class ASTContext(BaseModel):
    changed_functions: list[FunctionInfo] = []
    callers: list[CallerInfo] = []
    imports: list[str] = []
    class_context: Optional[str] = None
    call_graph_snippet: str = ""

class ReviewFinding(BaseModel):
    severity: Severity
    category: Category
    file: str
    line: int
    message: str
    suggestion: str
    confidence: float = Field(ge=0.0, le=1.0)
    cwe_id: Optional[str] = None    # e.g. "CWE-89" for SQL injection

class ReviewDecision(str, Enum):
    APPROVE = "APPROVE"
    REQUEST_CHANGES = "REQUEST_CHANGES"
    COMMENT = "COMMENT"

class ReviewState(BaseModel):
    # Identity
    review_id: str
    mode: Literal["precommit", "github_pr"]

    # Input
    diffs: list[FileDiff]
    ast_context: ASTContext
    pr_description: Optional[str] = None
    repo_style_context: Optional[str] = None
    full_file_contents: dict[str, str] = {}    # path → full content
    test_file_contents: dict[str, str] = {}    # path → test file content

    # Agent outputs
    logic_findings: list[ReviewFinding] = []
    security_findings: list[ReviewFinding] = []
    performance_findings: list[ReviewFinding] = []
    style_findings: list[ReviewFinding] = []
    test_findings: list[ReviewFinding] = []

    # Aggregated output
    final_findings: list[ReviewFinding] = []
    summary: str = ""
    decision: Optional[ReviewDecision] = None

    # Metadata
    token_count_used: int = 0
    models_used: dict[str, str] = {}           # node_name → model_name
    duration_seconds: float = 0.0

class WebhookJob(BaseModel):
    installation_id: int
    repo_owner: str
    repo_name: str
    pr_number: int
    head_sha: str
    base_sha: str
    pr_description: Optional[str] = None
    review_id: str
```

---

## 16. Repository Structure

```
reviewbot/
│
├── README.md
├── pyproject.toml                  ← package definition, deps, entry points
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── .reviewbot.yml.example
│
├── reviewbot/                      ← main Python package
│   ├── __init__.py
│   ├── models.py                   ← all Pydantic data models
│   ├── config.py                   ← config loading from .reviewbot.yml
│   │
│   ├── entrypoints/
│   │   ├── precommit.py            ← Entry Point A: git hook runner
│   │   └── github_app.py           ← Entry Point B: FastAPI webhook server
│   │
│   ├── ingestion/
│   │   ├── diff_extractor.py       ← git diff → FileDiff objects
│   │   ├── context_builder.py      ← FileDiff → full ReviewState
│   │   └── token_counter.py        ← tiktoken-based budget management
│   │
│   ├── ast_parser/
│   │   ├── __init__.py
│   │   ├── base.py                 ← abstract interface
│   │   ├── python_parser.py        ← tree-sitter Python implementation
│   │   ├── javascript_parser.py    ← tree-sitter JS/TS implementation
│   │   └── call_graph.py           ← cross-file call graph construction
│   │
│   ├── style_index/
│   │   ├── indexer.py              ← initial codebase scanning + embedding
│   │   ├── retriever.py            ← query ChromaDB for similar patterns
│   │   └── embedder.py             ← sentence-transformers wrapper
│   │
│   ├── pipeline/
│   │   ├── graph.py                ← LangGraph graph definition
│   │   ├── state.py                ← ReviewState management
│   │   └── runner.py               ← pipeline entry point
│   │
│   ├── agents/
│   │   ├── base.py                 ← base agent class with LLM call wrapper
│   │   ├── logic_reviewer.py
│   │   ├── security_scanner.py
│   │   ├── performance_reviewer.py
│   │   ├── style_checker.py
│   │   ├── test_analyst.py
│   │   └── aggregator.py
│   │
│   ├── llm/
│   │   ├── router.py               ← provider selection + fallback logic
│   │   ├── groq_client.py
│   │   ├── gemini_client.py
│   │   ├── ollama_client.py
│   │   └── cache.py                ← Redis + SQLite response cache
│   │
│   ├── output/
│   │   ├── terminal.py             ← colored terminal output
│   │   └── github_comments.py      ← GitHub Review API posting
│   │
│   ├── github/
│   │   ├── auth.py                 ← JWT + installation token generation
│   │   ├── api_client.py           ← GitHub REST API wrapper
│   │   └── webhook.py              ← signature verification
│   │
│   └── worker/
│       ├── __init__.py
│       └── arq_worker.py           ← ARQ job definitions
│
└── tests/
    ├── fixtures/                   ← sample diffs, ASTs for testing
    ├── test_diff_extractor.py
    ├── test_ast_parser.py
    ├── test_pipeline.py
    └── test_output.py
```

---

## 17. Technology Stack with Justifications

| Component | Technology | Why this? | Why not alternative? |
|---|---|---|---|
| API framework | FastAPI | Async-native, auto-generates OpenAPI docs, Pydantic integration | Flask is sync-first, Django is too heavy |
| Job queue | ARQ | Python-native, Redis-backed, async, minimal setup | Celery is heavier and overkill; BullMQ is Node.js only |
| Agent orchestration | LangGraph | Explicit state machine, parallel nodes, built-in checkpointing | LangChain agents are too opaque; custom code loses checkpointing |
| Code parsing | tree-sitter | Supports 50+ languages with one API, production-grade (GitHub uses it) | AST module is Python-only; regex is unreliable |
| Vector database | ChromaDB | Embedded (no server), Python-native, fast for local use | Qdrant/Pinecone require external servers; overkill for this use case |
| Embeddings | sentence-transformers (all-MiniLM-L6-v2) | Local, free, 22MB, fast on CPU | OpenAI embeddings cost money, require network |
| Diff parsing | unidiff | Handles all edge cases, battle-tested | Custom parser will miss edge cases (binary, renames, no-newline) |
| Token counting | tiktoken | OpenAI's official tokenizer, accurate for all GPT-family models | Rough estimates (chars/4) are inaccurate and cause context overflow |
| Terminal colors | colorama | Cross-platform (works on Windows cmd), lightweight | ANSI escape codes directly don't work on Windows |
| LLM (cloud) | Groq (primary) + Gemini Flash (fallback) | Groq: fastest inference, generous free tier. Gemini: 1M context window | OpenAI/Anthropic cost money for this scale |
| LLM (local) | Ollama + CodeLlama:13b | One-command install, code-specialized model, truly offline | llama.cpp requires manual setup; Hugging Face Transformers is complex |
| Containerization | Docker + Docker Compose | Industry standard, you already know it from SuperAlign | Bare metal deploys lose reproducibility |
| Data validation | Pydantic v2 | FastAPI-native, fast validation, great error messages | dataclasses lack validation; TypedDict has no runtime checking |

---

## 18. Environment Configuration

### `.env` file (server deployment)

```bash
# GitHub App credentials
GITHUB_APP_ID=123456
GITHUB_APP_NAME=reviewbot-ai
GITHUB_PRIVATE_KEY_PATH=/run/secrets/github_private_key
GITHUB_WEBHOOK_SECRET=your_webhook_secret_here

# LLM API keys (all optional — falls back to Ollama if missing)
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=AIza...

# Infrastructure
REDIS_URL=redis://localhost:6379/0
CHROMA_PERSIST_DIR=/data/chroma

# Review behavior
MAX_DIFF_LINES=1000           # Skip files with more changed lines than this
MAX_FILES_PER_REVIEW=20       # Skip PRs with more files than this
REVIEW_TIMEOUT_SECONDS=120    # Abandon review if pipeline takes longer

# Rate limiting
MAX_REVIEWS_PER_HOUR=100      # Per installation
CACHE_TTL_SECONDS=86400       # LLM response cache TTL (24 hours)
```

### `.reviewbot.yml` (per-repo configuration)

```yaml
precommit:
  enabled: true
  block_on: ["HIGH"]
  model: "codellama:13b"
  skip_paths:
    - "tests/**"
    - "migrations/**"
    - "vendor/**"
    - "*.lock"
    - "*.min.js"

github_app:
  enabled: true
  post_inline_comments: true
  post_summary_comment: true
  request_changes_on_high: true
  skip_paths:
    - "*.md"
    - "docs/**"
  focus:                     # Only run these agents (omit to run all)
    - security
    - logic
    - performance
    - style
    - test
```

---

## 19. Installation & Setup Flow

### For developers (pre-commit tool)

```bash
# 1. Install the package
pip install reviewbot-cli

# 2. Navigate to your git repo
cd /path/to/your/project

# 3. Install the git hook
reviewbot install

# 4. Index your codebase (one-time, run from repo root)
reviewbot init

# 5. (Optional) Pull Ollama model for offline use
ollama pull codellama:13b

# 6. Done — next git commit will trigger review
git add .
git commit -m "feat: add token validation"
# → ReviewBot runs automatically
```

### For teams (GitHub App)

```bash
# 1. Deploy the server
git clone https://github.com/your-handle/reviewbot
cd reviewbot
cp .env.example .env
# Edit .env with your GitHub App credentials

docker-compose up -d

# 2. Register GitHub App at github.com/settings/apps/new
#    Webhook URL: https://your-server.com/webhook
#    Permissions: Pull requests (read/write), Contents (read)
#    Events: Pull request

# 3. Install the GitHub App on your repo at:
#    github.com/apps/reviewbot-ai/installations/new

# 4. Open a PR — ReviewBot reviews it automatically
```

---

## 20. Interview Talking Points — Architecture Decisions

These are the questions you will be asked, and the answers that demonstrate depth:

**"Why LangGraph instead of a single LLM call?"**
A single prompt produces generic output and cannot parallelize. LangGraph lets 5 specialized agents run simultaneously, each with a focused prompt and its own section of the state. Total latency is ~3s (slowest single agent) instead of 15s (5 sequential calls). More importantly, the explicit state machine lets me add conditional edges — for example, skipping the performance node for files under 20 lines, or routing security findings to a second verification pass before flagging as HIGH.

**"Why AST parsing instead of just sending the diff?"**
A diff shows what changed, but not why it matters. If you change a function that 30 other functions call, the LLM needs to know about those callers to judge whether the signature change is safe. Tree-sitter extracts the actual call graph — not just text-matching, but the real syntactic structure. This is the same approach Sourcegraph and GitHub Copilot use internally.

**"Why ChromaDB for the style index? Why not just include the whole codebase in context?"**
Including the whole codebase would be 50,000-500,000 tokens per review — impossible with any free model. ChromaDB gives us semantic retrieval: we embed every function and at review time retrieve only the 3 most similar existing functions. This gives the style agent real codebase context at a cost of ~300 tokens instead of 500,000.

**"How do you handle the cost problem?"**
Three layers. First, tiered model routing: logic and security use the 70B model, less critical agents use the 8B model. Second, response caching: LLM responses are cached by SHA256(prompt) in Redis with 24h TTL — common patterns (like reviewing a for loop) get cache hits ~30-40% of the time. Third, provider fallback: Groq primary → Gemini fallback → Ollama local. I can serve thousands of reviews per day at near-zero cost.

**"What's the hardest engineering problem you solved in this project?"**
Token budget management. You have 6 different context sources (diff, full file, callers, test file, PR description, style context) and a hard limit of 6000 tokens. Each source has different importance depending on the type of review. I implemented a priority-based truncation system — if over budget, drop test file first, then callers, then truncate full file to only the changed function's class. This way the most critical context is always present while less critical context gracefully degrades.

**"If you had to scale this to 10,000 PRs per day, what breaks first?"**
The Groq free tier rate limit (14,400 req/day across all agents = ~2,800 PRs/day max). Solution: introduce a paid tier for heavy users, add Together.ai and Fireworks.ai as additional providers, and increase Redis cache TTL to 72h to improve hit rate. The LangGraph pipeline and Redis queue scale horizontally trivially — just add more worker containers.

---

*Document version: 1.0 | Project: AI Code Review Agent | Status: Ready for implementation*
