import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { callLLM } from './llmRouter';
import { ReviewFinding, ReviewState } from './types';

const overwrite = <T>() => (a: T, b: T) => b;

const ReviewAnnotation = Annotation.Root({
  diff: Annotation<string>({ value: overwrite<string>(), default: () => '' }),
  sourceCode: Annotation<string>({ value: overwrite<string>(), default: () => '' }),
  filePath: Annotation<string>({ value: overwrite<string>(), default: () => '' }),
  modifiedLines: Annotation<number[]>({ value: overwrite<number[]>(), default: () => [] }),
  functionContext: Annotation<string>({ value: overwrite<string>(), default: () => '' }),
  securityFindings: Annotation<ReviewFinding[]>({ value: overwrite<ReviewFinding[]>(), default: () => [] }),
  logicFindings: Annotation<ReviewFinding[]>({ value: overwrite<ReviewFinding[]>(), default: () => [] }),
  styleFindings: Annotation<ReviewFinding[]>({ value: overwrite<ReviewFinding[]>(), default: () => [] }),
  finalFindings: Annotation<ReviewFinding[]>({ value: overwrite<ReviewFinding[]>(), default: () => [] }),
});

type GraphState = typeof ReviewAnnotation.State;

const SYSTEM_PROMPTS: Record<string, string> = {
  security: [
    'You are a security-focused code reviewer. Review the git diff for security vulnerabilities.',
    'Focus on: SQL injection, XSS, CSRF, authentication/authorization issues, unsafe deserialization,',
    'path traversal, command injection, hardcoded secrets, insecure cryptography, and input validation.',
    'Return a JSON object with key "findings" containing an array of issues.',
    'Each issue has: line (1-based), severity ("error"|"warning"|"info"), message, suggestion.',
    'Return {"findings": []} if no security issues found.',
    'Respond ONLY with the JSON object, no other text.',
  ].join('\n'),
  logic: [
    'You are a logic-focused code reviewer. Review the git diff for logical bugs.',
    'Focus on: race conditions, off-by-one errors, incorrect conditionals, null/undefined dereferences,',
    'incorrect state management, type mismatches, async/await issues, incorrect error handling,',
    'infinite loops, and incorrect algorithm implementation.',
    'Return a JSON object with key "findings" containing an array of issues.',
    'Each issue has: line (1-based), severity ("error"|"warning"|"info"), message, suggestion.',
    'Return {"findings": []} if no logic issues found.',
    'Respond ONLY with the JSON object, no other text.',
  ].join('\n'),
  style: [
    'You are a code quality reviewer. Review the git diff for maintainability issues.',
    'Focus on: deeply nested code, duplicated code blocks, overly complex expressions,',
    'missing error handling, magic numbers, unused variables, excessively long functions,',
    'overly broad try-catch, and misleading naming.',
    'Do NOT comment on formatting, indentation, whitespace, or trivial style preferences.',
    'Return a JSON object with key "findings" containing an array of issues.',
    'Each issue has: line (1-based), severity ("error"|"warning"|"info"), message, suggestion.',
    'Return {"findings": []} if no quality issues found.',
    'Respond ONLY with the JSON object, no other text.',
  ].join('\n'),
};

const PERSONA_FOCUS: Record<string, string> = {
  security: 'security vulnerabilities',
  logic: 'logic bugs',
  style: 'code quality',
};

function buildPersonaPrompt(persona: string, diff: string, functionContext: string): string {
  const parts = [
    `Review the following git diff ${diff ? 'and function context' : ''} for ${PERSONA_FOCUS[persona]}.`,
    '',
  ];
  if (functionContext) {
    parts.push('Function context:', functionContext, '');
  }
  parts.push('Diff:', diff);
  return parts.join('\n');
}

export function parseFindings(text: string): ReviewFinding[] {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed as ReviewFinding[];
    }
    if (parsed && Array.isArray(parsed.findings)) {
      return parsed.findings as ReviewFinding[];
    }
    return [];
  } catch {
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const extracted = JSON.parse(arrayMatch[0]);
        if (Array.isArray(extracted)) return extracted as ReviewFinding[];
      } catch {
        return [];
      }
    }
    return [];
  }
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

  for (const [line, findings] of groups) {
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

async function securityScanner(state: GraphState): Promise<Partial<GraphState>> {
  try {
    const prompt = buildPersonaPrompt('security', state.diff, state.functionContext);
    const response = await callLLM({ prompt, systemPrompt: SYSTEM_PROMPTS.security });
    return { securityFindings: parseFindings(response.text) };
  } catch {
    return { securityFindings: [] };
  }
}

async function logicReviewer(state: GraphState): Promise<Partial<GraphState>> {
  try {
    const prompt = buildPersonaPrompt('logic', state.diff, state.functionContext);
    const response = await callLLM({ prompt, systemPrompt: SYSTEM_PROMPTS.logic });
    return { logicFindings: parseFindings(response.text) };
  } catch {
    return { logicFindings: [] };
  }
}

async function styleChecker(state: GraphState): Promise<Partial<GraphState>> {
  try {
    const prompt = buildPersonaPrompt('style', state.diff, state.functionContext);
    const response = await callLLM({ prompt, systemPrompt: SYSTEM_PROMPTS.style });
    return { styleFindings: parseFindings(response.text) };
  } catch {
    return { styleFindings: [] };
  }
}

async function aggregator(state: GraphState): Promise<Partial<GraphState>> {
  const all = [
    ...state.securityFindings,
    ...state.logicFindings,
    ...state.styleFindings,
  ];
  return { finalFindings: deduplicateFindings(all) };
}

export function createReviewGraph() {
  const graph = new StateGraph(ReviewAnnotation)
    .addNode('securityScanner', securityScanner)
    .addNode('logicReviewer', logicReviewer)
    .addNode('styleChecker', styleChecker)
    .addNode('aggregator', aggregator)
    .addEdge(START, 'securityScanner')
    .addEdge(START, 'logicReviewer')
    .addEdge(START, 'styleChecker')
    .addEdge('securityScanner', 'aggregator')
    .addEdge('logicReviewer', 'aggregator')
    .addEdge('styleChecker', 'aggregator')
    .addEdge('aggregator', END);

  return graph.compile();
}

export async function runReviewGraph(initialState: ReviewState): Promise<{ finalFindings: ReviewFinding[] }> {
  const app = createReviewGraph();
  const result = await app.invoke({
    diff: initialState.diff,
    sourceCode: initialState.sourceCode,
    filePath: initialState.filePath,
    modifiedLines: initialState.modifiedLines,
    functionContext: initialState.functionContext,
    securityFindings: [],
    logicFindings: [],
    styleFindings: [],
    finalFindings: [],
  });
  return { finalFindings: result.finalFindings };
}
