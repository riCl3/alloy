export type Severity = 'error' | 'warning' | 'info';

export interface ReviewFinding {
  line: number;
  severity: Severity;
  message: string;
  suggestion: string;
}

export interface ReviewState {
  diff: string;
  filePath: string;
  modifiedLines: number[];
  functionContext: string;
  similarFunctions: string;
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
