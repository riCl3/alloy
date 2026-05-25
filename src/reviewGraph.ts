import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { callLLM } from './llmRouter';
import { ReviewFinding, ReviewState } from './types';

const REVIEW_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['error', 'warning', 'info'] },
          message: { type: 'string' },
          suggestion: { type: 'string' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          replacement: { type: 'string' },
          rationale: { type: 'string' },
          range: {
            type: 'object',
            properties: {
              startLine: { type: 'integer' },
              startCharacter: { type: 'integer' },
              endLine: { type: 'integer' },
              endCharacter: { type: 'integer' },
            },
            required: ['startLine', 'startCharacter', 'endLine', 'endCharacter'],
            additionalProperties: false,
          },
          category: {
            type: 'string',
            enum: ['security', 'logic', 'quality', 'performance', 'test'],
          },
        },
        required: ['line', 'severity', 'message', 'suggestion'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
};

const overwrite = <T>() => (_a: T, b: T) => b;

const ReviewAnnotation = Annotation.Root({
  diff: Annotation<string>({ value: overwrite<string>(), default: () => '' }),
  enumeratedDiff: Annotation<string>({ value: overwrite<string>(), default: () => '' }),
  filePath: Annotation<string>({ value: overwrite<string>(), default: () => '' }),
  modifiedLines: Annotation<number[]>({ value: overwrite<number[]>(), default: () => [] }),
  functionContext: Annotation<string>({ value: overwrite<string>(), default: () => '' }),
  similarFunctions: Annotation<string>({ value: overwrite<string>(), default: () => '' }),
  packageContext: Annotation<string>({ value: overwrite<string>(), default: () => '' }),
  reviewMode: Annotation<string>({ value: overwrite<string>(), default: () => 'fast' }),
  securityFindings: Annotation<ReviewFinding[]>({ value: overwrite<ReviewFinding[]>(), default: () => [] }),
  logicFindings: Annotation<ReviewFinding[]>({ value: overwrite<ReviewFinding[]>(), default: () => [] }),
  styleFindings: Annotation<ReviewFinding[]>({ value: overwrite<ReviewFinding[]>(), default: () => [] }),
  performanceFindings: Annotation<ReviewFinding[]>({ value: overwrite<ReviewFinding[]>(), default: () => [] }),
  testFindings: Annotation<ReviewFinding[]>({ value: overwrite<ReviewFinding[]>(), default: () => [] }),
  finalFindings: Annotation<ReviewFinding[]>({ value: overwrite<ReviewFinding[]>(), default: () => [] }),
});

type GraphState = typeof ReviewAnnotation.State;

const FIELD_GUIDE = [
  'Return a JSON object with key "findings" containing an array of issues.',
  'Each issue has: line, severity, message, suggestion.',
  '- "line": Line number from the "[Line N]" prefix shown in the changed code below (this is the absolute line number in the current file)',
  '- "severity": "error", "warning", or "info"',
  '- "message": One sentence describing the problem. MAX 100 characters. NEVER include code, file paths, or file content.',
  '- "suggestion": What to do INSTEAD — describe the better approach, not just what to remove. MAX 150 characters. NEVER include code.',
  '- Optional "confidence": "high", "medium", or "low". Use "high" only when you are certain.',
  '- Optional "range": exact current-file range to replace, using 1-based line numbers and 0-based characters.',
  '- Optional "replacement": patch-ready replacement text. Include it ONLY for high-confidence local fixes.',
  '- Optional "rationale": one short explanation of why the fix is safer.',
  'Return {"findings": []} if no issues found.',
  'Respond ONLY with the JSON object, no other text.',
].join('\n');

const SYSTEM_PROMPTS: Record<string, string> = {
  security: [
    'You are a security-focused code reviewer. Review the git diff for security vulnerabilities.',
    'Focus on: SQL injection, XSS, CSRF, authentication/authorization issues, unsafe deserialization,',
    'path traversal, command injection, hardcoded secrets, insecure cryptography, and input validation.',
    FIELD_GUIDE,
  ].join('\n'),
  logic: [
    'You are a logic-focused code reviewer. Review the git diff for logical bugs.',
    'Focus on: race conditions, off-by-one errors, incorrect conditionals, null/undefined dereferences,',
    'incorrect state management, type mismatches, async/await issues, incorrect error handling,',
    'infinite loops, and incorrect algorithm implementation.',
    FIELD_GUIDE,
  ].join('\n'),
  style: [
    'You are a code quality reviewer. Review the git diff for maintainability issues.',
    'Focus on: deeply nested code, duplicated code blocks, overly complex expressions,',
    'missing error handling, magic numbers, unused variables, excessively long functions,',
    'overly broad try-catch, and misleading naming.',
    'Do NOT comment on formatting, indentation, whitespace, or trivial style preferences.',
    'If similar code examples are provided below, align your suggestions with the',
    'established patterns and conventions visible in those examples.',
    FIELD_GUIDE,
  ].join('\n'),
  performance: [
    'You are a performance-focused code reviewer. Review the git diff for performance issues.',
    'Focus on: N+1 query problems, blocking I/O in async functions, unnecessary repeated computation,',
    'large data structures loaded fully into memory, inefficient string concatenation in loops,',
    'missing caching for expensive computations, and O(n²) algorithms where n could be large.',
    'Only flag issues that would be measurably slow at realistic production scale.',
    'Do NOT flag micro-optimizations.',
    FIELD_GUIDE,
  ].join('\n'),
  test: [
    'You are a test coverage analyst. Review the git diff for test gaps and edge cases.',
    'Focus on: untested edge cases in the changed code, missing tests for new functions,',
    'incomplete boundary conditions, missing error-path tests, and unrealistic mocks.',
    'For each gap, describe the missing test scenario — not the code to implement it.',
    FIELD_GUIDE,
  ].join('\n'),
  comprehensive: [
    'You are a comprehensive code reviewer. Review the diff across ALL these categories:',
    '',
    '1. SECURITY: SQL injection, XSS, CSRF, auth/authorization issues, unsafe deserialization,',
    '   path traversal, command injection, hardcoded secrets, insecure cryptography, input validation.',
    '2. LOGIC: Race conditions, off-by-one errors, incorrect conditionals, null/undefined dereferences,',
    '   incorrect state management, type mismatches, async/await issues, incorrect error handling,',
    '   infinite loops, incorrect algorithm implementation.',
    '3. CODE QUALITY: Deeply nested code, duplicated code blocks, overly complex expressions,',
    '   missing error handling, magic numbers, unused variables, excessively long functions,',
    '   overly broad try-catch, misleading naming.',
    '4. PERFORMANCE: N+1 query problems, blocking I/O in async functions, unnecessary repeated computation,',
    '   large data structures loaded fully into memory, inefficient string concatenation in loops,',
    '   missing caching for expensive computations, O(n²) algorithms where n could be large.',
    '   Only flag measurably slow issues at production scale.',
    '5. TEST GAPS: Untested edge cases in the changed code, missing tests for new functions,',
    '   incomplete boundary conditions, missing error-path tests, unrealistic mocks.',
    '',
    'For each finding, include a "category" field: "security", "logic", "quality", "performance", or "test".',
    'Prefer actionable issues that are line-specific and directly related to modified code.',
    FIELD_GUIDE,
  ].join('\n'),
  architecture: [
    'You are a senior architecture reviewer. Review the local git diff for design, maintainability, and correctness risks.',
    'Focus on API boundaries, hidden coupling, state ownership, async flow, error handling, testability, and long-term maintainability.',
    'Do not flag broad preferences. Only return concrete issues that a developer can act on in this diff.',
    'For each finding, include a "category" field: "logic", "quality", "performance", "security", or "test".',
    FIELD_GUIDE,
  ].join('\n'),
};

const PERSONA_FOCUS: Record<string, string> = {
  security: 'security vulnerabilities',
  logic: 'logic bugs',
  style: 'code quality',
  performance: 'performance issues',
  test: 'test coverage gaps',
};

function buildPersonaPrompt(persona: string, enumeratedDiff: string, functionContext: string, similarFunctions?: string): string {
  const parts = [
    `Review the following code changes ${functionContext ? 'and function context' : ''} for ${PERSONA_FOCUS[persona]}.`,
    '',
  ];
  if (functionContext) {
    parts.push('Function context:', functionContext, '');
  }
  if (persona === 'style' && similarFunctions) {
    parts.push('Similar codebase patterns:', similarFunctions, '');
  }
  parts.push('Changed code (lines prefixed with [Line N]; lines ending in <-- MODIFIED were changed):', enumeratedDiff);
  return parts.join('\n');
}

function looksLikeCode(text: string): boolean {
  const patterns = [
    /^import\s/,
    /^export\s/,
    /^const\s/,
    /^let\s/,
    /^var\s/,
    /^function\s/,
    /^class\s/,
    /^interface\s/,
    /^type\s/,
    /^from\s/,
    /^['"`]use /,
    /^\s*<\w/,
    /\bfunction\b.*\{/,
    /=>\s*\{/,
    /<[A-Z]\w+/,
    /<\/\w+>/,
    /^\s*\}\s*$/,
  ];
  return patterns.some((p) => p.test(text.trim()));
}

function sanitizeMessage(text: string, maxLen = 80): string {
  if (!text) return '';
  const cleaned = text
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (looksLikeCode(cleaned)) return '';
  if (cleaned.length > maxLen) {
    return cleaned.slice(0, maxLen - 3) + '...';
  }
  return cleaned;
}

function sanitizeFinding(raw: Record<string, unknown>): ReviewFinding | null {
  const line = typeof raw.line === 'number' ? raw.line : parseInt(String(raw.line), 10);
  if (!line || line < 1) return null;

  const validSeverities: ReviewFinding['severity'][] = ['error', 'warning', 'info'];
  const severity = validSeverities.includes(raw.severity as ReviewFinding['severity'])
    ? (raw.severity as ReviewFinding['severity'])
    : 'warning';

  let message = sanitizeMessage(typeof raw.message === 'string' ? raw.message : '');

  if (!message) {
    message = `${severity === 'error' ? 'Issue' : severity === 'warning' ? 'Warning' : 'Note'} found at line ${line}`;
  }

  let suggestion = sanitizeMessage(typeof raw.suggestion === 'string' ? raw.suggestion : '', 150);

  const validCategories: ReviewFinding['category'][] = ['security', 'logic', 'quality', 'performance', 'test'];
  const category = validCategories.includes(raw.category as ReviewFinding['category'])
    ? (raw.category as ReviewFinding['category'])
    : undefined;

  const validConfidences: ReviewFinding['confidence'][] = ['low', 'medium', 'high'];
  const confidence = validConfidences.includes(raw.confidence as ReviewFinding['confidence'])
    ? (raw.confidence as ReviewFinding['confidence'])
    : undefined;
  const replacement = typeof raw.replacement === 'string' && raw.replacement.trim().length > 0
    ? raw.replacement
    : undefined;
  const rationale = sanitizeMessage(typeof raw.rationale === 'string' ? raw.rationale : '', 180) || undefined;
  const range = sanitizeRange(raw.range, line);
  const id = buildFindingId({ line, severity, message, suggestion, category });

  return { id, line, severity, message, suggestion, category, confidence, replacement, rationale, range };
}

function sanitizeRange(raw: unknown, fallbackLine: number): ReviewFinding['range'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const startLine = toPositiveInt(record.startLine);
  const endLine = toPositiveInt(record.endLine);
  const startCharacter = toNonNegativeInt(record.startCharacter);
  const endCharacter = toNonNegativeInt(record.endCharacter);
  if (!startLine || !endLine || startCharacter === undefined || endCharacter === undefined) return undefined;
  if (startLine > endLine) return undefined;
  if (startLine !== fallbackLine && endLine !== fallbackLine) return undefined;
  return { startLine, startCharacter, endLine, endCharacter };
}

function toPositiveInt(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function toNonNegativeInt(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function buildFindingId(finding: Pick<ReviewFinding, 'line' | 'severity' | 'message' | 'suggestion' | 'category'>): string {
  const basis = `${finding.line}:${finding.severity}:${finding.category ?? 'general'}:${finding.message}:${finding.suggestion}`;
  let hash = 0;
  for (let i = 0; i < basis.length; i++) {
    hash = ((hash << 5) - hash + basis.charCodeAt(i)) | 0;
  }
  return `alloy-${finding.line}-${Math.abs(hash).toString(36)}`;
}

export function parseFindings(text: string): ReviewFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (!jsonMatch) return [];
    try {
      parsed = JSON.parse(jsonMatch[1]);
    } catch {
      return [];
    }
  }

  const rawArray = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).findings)
      ? (parsed as Record<string, unknown>).findings as Record<string, unknown>[]
      : null;

  if (!rawArray) return [];

  return rawArray
    .map((item) => (typeof item === 'object' && item !== null ? sanitizeFinding(item as Record<string, unknown>) : null))
    .filter((f): f is ReviewFinding => f !== null);
}

export function deduplicateFindings(all: ReviewFinding[]): ReviewFinding[] {
  const groups = new Map<number, ReviewFinding[]>();
  for (const f of all) {
    const existing = groups.get(f.line) ?? [];
    existing.push(f);
    groups.set(f.line, existing);
  }

  const result: ReviewFinding[] = [];
  const severityOrder = { error: 3, warning: 2, info: 1 };

  for (const [, findings] of groups) {
    const merged = findings.reduce((best, current) => {
      if (severityOrder[current.severity] > severityOrder[best.severity]) {
        return current;
      }
      if (severityOrder[current.severity] === severityOrder[best.severity] && best.message.length < current.message.length) {
        return current;
      }
      return best;
    });

    result.push(merged);
  }

  result.sort((a, b) => a.line - b.line);
  return result;
}

const PERSONA_OUTPUT_FIELD: Record<string, string> = {
  security: 'securityFindings',
  logic: 'logicFindings',
  style: 'styleFindings',
  performance: 'performanceFindings',
  test: 'testFindings',
};

function createPersonaReviewer(persona: string) {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    try {
      const useSimilarFunctions = persona === 'style';
      const diffForPrompt = state.enumeratedDiff || state.diff;
      const prompt = buildPersonaPrompt(persona, diffForPrompt, state.functionContext, useSimilarFunctions ? state.similarFunctions : undefined);
      const response = await callLLM({ prompt, systemPrompt: SYSTEM_PROMPTS[persona], responseSchema: REVIEW_SCHEMA });
      return { [PERSONA_OUTPUT_FIELD[persona]]: parseFindings(response.text) };
    } catch (err) {
      console.error(`[Alloy] ${persona} reviewer failed: ${(err as Error).message}`);
      return { [PERSONA_OUTPUT_FIELD[persona]]: [] };
    }
  };
}

const securityScanner = createPersonaReviewer('security');
const logicReviewer = createPersonaReviewer('logic');
const styleChecker = createPersonaReviewer('style');
const performanceReviewer = createPersonaReviewer('performance');
const testAnalyst = createPersonaReviewer('test');

function buildComprehensivePrompt(diff: string, functionContext: string, similarFunctions?: string): string {
  const parts = [
    'Review the following code changes for all categories of issues (security, logic, code quality, performance, test coverage).',
    '',
  ];
  if (functionContext) {
    parts.push('Function context:', functionContext, '');
  }
  if (similarFunctions) {
    parts.push('Similar codebase patterns:', similarFunctions, '');
  }
  parts.push('Review constraints:', 'Only flag actionable problems introduced or exposed by changed lines.', '');
  parts.push('Changed code (lines prefixed with [Line N]; lines ending in <-- MODIFIED were changed):', diff);
  return parts.join('\n');
}

async function comprehensiveReviewer(state: GraphState): Promise<Partial<GraphState>> {
  try {
    const diffForPrompt = state.enumeratedDiff || state.diff;
    const promptParts = [buildComprehensivePrompt(diffForPrompt, state.functionContext, state.similarFunctions)];
    if (state.packageContext) promptParts.push('', state.packageContext);
    const systemPrompt = state.reviewMode === 'architecture' ? SYSTEM_PROMPTS.architecture : SYSTEM_PROMPTS.comprehensive;
    const response = await callLLM({ prompt: promptParts.join('\n'), systemPrompt, responseSchema: REVIEW_SCHEMA });
    const findings = parseFindings(response.text);
    return { finalFindings: findings };
  } catch (err) {
    console.error(`[Alloy] comprehensive reviewer failed: ${(err as Error).message}`);
    return { finalFindings: [] };
  }
}

function adjustFindingLineNumbers(findings: ReviewFinding[], diff: string): ReviewFinding[] {
  const hunks: { newStart: number; newCount: number }[] = [];
  const regex = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/g;
  let match;
  while ((match = regex.exec(diff)) !== null) {
    hunks.push({
      newStart: parseInt(match[1], 10),
      newCount: match[2] ? parseInt(match[2], 10) : 1,
    });
  }
  if (hunks.length === 0) return findings;

  const firstHunkStart = hunks[0].newStart;

  return findings.map((f) => {
    const inAnyHunk = hunks.some(
      (h) => f.line >= h.newStart && f.line < h.newStart + h.newCount,
    );
    if (inAnyHunk) return f;

    if (f.line < firstHunkStart && f.line <= 50) {
      const adjusted = firstHunkStart + f.line - 1;
      const adjustedInHunk = hunks.some(
        (h) => adjusted >= h.newStart && adjusted < h.newStart + h.newCount,
      );
      if (adjustedInHunk) {
        return { ...f, line: adjusted };
      }
    }
    return f;
  });
}

async function aggregator(state: GraphState): Promise<Partial<GraphState>> {
  const all = [
    ...state.securityFindings,
    ...state.logicFindings,
    ...state.styleFindings,
    ...state.performanceFindings,
    ...state.testFindings,
  ];
  const adjusted = adjustFindingLineNumbers(all, state.diff);
  const deduplicated = deduplicateFindings(adjusted);
  const modifiedSet = new Set(state.modifiedLines);
  const filtered = deduplicated.filter((f) => modifiedSet.has(f.line));
  console.log(`[Alloy] aggregator: ${deduplicated.length} deduplicated, ${deduplicated.length - filtered.length} filtered out (not in modifiedLines)`);
  return { finalFindings: filtered };
}

let cachedFullGraph: ReturnType<typeof createReviewGraph> | null = null;
let cachedSingleGraph: ReturnType<typeof createReviewGraph> | null = null;

export function createReviewGraph(singleAgent = false) {
  if (singleAgent) {
    const graph = new StateGraph(ReviewAnnotation)
      .addNode('comprehensiveReviewer', comprehensiveReviewer)
      .addEdge(START, 'comprehensiveReviewer')
      .addEdge('comprehensiveReviewer', END);

    return graph.compile();
  }

  const graph = new StateGraph(ReviewAnnotation)
    .addNode('securityScanner', securityScanner)
    .addNode('logicReviewer', logicReviewer)
    .addNode('styleChecker', styleChecker)
    .addNode('performanceReviewer', performanceReviewer)
    .addNode('testAnalyst', testAnalyst)
    .addNode('aggregator', aggregator)
    .addEdge(START, 'securityScanner')
    .addEdge(START, 'logicReviewer')
    .addEdge(START, 'styleChecker')
    .addEdge(START, 'performanceReviewer')
    .addEdge(START, 'testAnalyst')
    .addEdge('securityScanner', 'aggregator')
    .addEdge('logicReviewer', 'aggregator')
    .addEdge('styleChecker', 'aggregator')
    .addEdge('performanceReviewer', 'aggregator')
    .addEdge('testAnalyst', 'aggregator')
    .addEdge('aggregator', END);

  return graph.compile();
}

function getCompiledGraph(singleAgent: boolean) {
  if (singleAgent) {
    if (!cachedSingleGraph) {
      cachedSingleGraph = createReviewGraph(true);
    }
    return cachedSingleGraph;
  }
  if (!cachedFullGraph) {
    cachedFullGraph = createReviewGraph(false);
  }
  return cachedFullGraph;
}

export async function runReviewGraph(initialState: ReviewState): Promise<{ finalFindings: ReviewFinding[] }> {
  const app = getCompiledGraph(initialState.singleAgent);
  const result = await app.invoke({
    diff: initialState.diff,
    enumeratedDiff: initialState.enumeratedDiff,
    filePath: initialState.filePath,
    modifiedLines: initialState.modifiedLines,
    functionContext: initialState.functionContext,
    similarFunctions: initialState.similarFunctions,
    packageContext: initialState.packageContext ?? '',
    reviewMode: initialState.reviewMode ?? 'fast',
    securityFindings: [],
    logicFindings: [],
    styleFindings: [],
    performanceFindings: [],
    testFindings: [],
    finalFindings: [],
  });
  return { finalFindings: result.finalFindings };
}
