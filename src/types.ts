export type Severity = 'error' | 'warning' | 'info';

export interface ReviewFinding {
  line: number;
  severity: Severity;
  message: string;
  suggestion: string;
}
