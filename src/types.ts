export type Severity = 'error' | 'warning' | 'info';

export type FindingCategory = 'security' | 'logic' | 'quality' | 'performance' | 'test';

export interface ReviewFinding {
  line: number;
  severity: Severity;
  message: string;
  suggestion: string;
  category?: FindingCategory;
}

export interface ReviewState {
  diff: string;
  enumeratedDiff: string;
  filePath: string;
  modifiedLines: number[];
  functionContext: string;
  similarFunctions: string;
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
  provider: 'groq' | 'gemini';
  model: string;
}
