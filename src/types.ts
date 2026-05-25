export type Severity = 'error' | 'warning' | 'info';

export type FindingCategory = 'security' | 'logic' | 'quality' | 'performance' | 'test';
export type FindingConfidence = 'low' | 'medium' | 'high';
export type ReviewMode = 'fast' | 'deep' | 'architecture';
export type LLMProviderId = 'groq' | 'gemini' | 'openaiCompatible' | 'ollama';

export interface FindingRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

export interface ReviewFinding {
  id?: string;
  line: number;
  severity: Severity;
  message: string;
  suggestion: string;
  category?: FindingCategory;
  range?: FindingRange;
  replacement?: string;
  confidence?: FindingConfidence;
  rationale?: string;
}

export interface ReviewState {
  diff: string;
  enumeratedDiff: string;
  filePath: string;
  modifiedLines: number[];
  functionContext: string;
  similarFunctions: string;
  packageContext?: string;
  reviewMode?: ReviewMode;
  singleAgent: boolean;
  securityFindings: ReviewFinding[];
  logicFindings: ReviewFinding[];
  styleFindings: ReviewFinding[];
  performanceFindings: ReviewFinding[];
  testFindings: ReviewFinding[];
  finalFindings: ReviewFinding[];
}

export interface LLMResponse {
  text: string;
  provider: LLMProviderId;
  model: string;
}

export interface AlloyRuntimeConfig {
  provider: LLMProviderId;
  model: string;
  reviewMode: ReviewMode;
  maxDiffLines: number;
  maxFilesPerReview: number;
  skipPaths: string[];
  enabledCategories: FindingCategory[];
  enabledSeverities: Severity[];
  debounceMs: number;
}
