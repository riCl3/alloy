import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { callLLM } from './llmRouter';
import { ReviewFinding, ReviewState } from './types';

const overwrite = <T>() => (_a: T, b: T) => b;

const ReviewAnnotation = Annotation.Root({
  diff: Annotation<string>({ value: overwrite<string>(), default: () => '' }),
  filePath: Annotation<string>({ value: overwrite<string>(), default: () => '' }),
  modifiedLines: Annotation<number[]>({ value: overwrite<number[]>(), default: () => [] }),
  functionContext: Annotation<string>({ value: overwrite<string>(), default: () => '' }),
  similarFunctions: Annotation<string>({ value: overwrite<string>(), default: () => '' }),
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
  '- "line": 1-based line number in the NEW (modified) file (use the absolute line number from the diff hunk headers)',
  '- "severity": "error", "warning", or "info"',
  '- "message": One sentence describing the problem. MAX 100 characters. NEVER include code, file paths, or file content.',
  '- "suggestion": One sentence describing how to fix it. MAX 150 characters. NEVER include code.',
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
};

const PERSONA_FOCUS: Record<string, string> = {
  security: 'security vulnerabilities',
  logic: 'logic bugs',
  style: 'code quality',
  performance: 'performance issues',
  test: 'test coverage gaps',
};

function buildPersonaPrompt(persona: string, diff: string, functionContext: string, similarFunctions?: string): string {
  const parts = [
    `Review the following git diff ${functionContext ? 'and function context' : ''} for ${PERSONA_FOCUS[persona]}.`,
    '',
  ];
  if (functionContext) {
    parts.push('Function context:', functionContext, '');
  }
  if (persona === 'style' && similarFunctions) {
    parts.push('Similar codebase patterns:', similarFunctions, '');
  }
  parts.push('Diff:', diff);
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

  return { line, severity, message, suggestion };
}

export function parseFindings(text: string): ReviewFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        parsed = JSON.parse(arrayMatch[0]);
      } catch {
        return [];
      }
    } else {
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
      const prompt = buildPersonaPrompt(persona, state.diff, state.functionContext, useSimilarFunctions ? state.similarFunctions : undefined);
      const response = await callLLM({ prompt, systemPrompt: SYSTEM_PROMPTS[persona] });
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
  return { finalFindings: deduplicateFindings(adjusted) };
}

let cachedGraph: ReturnType<typeof createReviewGraph> | null = null;

export function createReviewGraph() {
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

function getCompiledGraph() {
  if (!cachedGraph) {
    cachedGraph = createReviewGraph();
  }
  return cachedGraph;
}

export async function runReviewGraph(initialState: ReviewState): Promise<{ finalFindings: ReviewFinding[] }> {
  const app = getCompiledGraph();
  const result = await app.invoke({
    diff: initialState.diff,
    filePath: initialState.filePath,
    modifiedLines: initialState.modifiedLines,
    functionContext: initialState.functionContext,
    similarFunctions: initialState.similarFunctions,
    securityFindings: [],
    logicFindings: [],
    styleFindings: [],
    performanceFindings: [],
    testFindings: [],
    finalFindings: [],
  });
  return { finalFindings: result.finalFindings };
}
