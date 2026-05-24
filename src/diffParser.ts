export interface HunkLine {
  type: 'added' | 'removed' | 'context';
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: HunkLine[];
}

export interface ParsedDiff {
  filePath: string;
  oldPath: string;
  newPath: string;
  hunks: Hunk[];
  addedLines: { lineNumber: number; content: string }[];
  removedLines: { lineNumber: number; content: string }[];
  rawDiff: string;
  isNewFile: boolean;
  isDeletedFile: boolean;
}

const RANGE_LINE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/;

function parseHeaderLine(line: string): { side: 'old' | 'new'; path: string } | null {
  if (line.startsWith('--- ')) {
    const raw = line.slice(4);
    const path = raw.startsWith('a/') ? raw.slice(2) : raw;
    return { side: 'old', path };
  }
  if (line.startsWith('+++ ')) {
    const raw = line.slice(4);
    const path = raw.startsWith('b/') ? raw.slice(2) : raw;
    return { side: 'new', path };
  }
  return null;
}

export function buildEnumeratedDiff(parsedDiff: ParsedDiff): string {
  if (parsedDiff.hunks.length === 0) return '';

  const result: string[] = [];

  for (const hunk of parsedDiff.hunks) {
    for (const hunkLine of hunk.lines) {
      if (hunkLine.type === 'added') {
        result.push(`[Line ${hunkLine.newLineNumber}] ${hunkLine.content}  <-- MODIFIED`);
      } else if (hunkLine.type === 'context') {
        result.push(`[Line ${hunkLine.newLineNumber}] ${hunkLine.content}`);
      }
    }
  }

  return result.join('\n');
}

export function parseUnifiedDiff(rawDiff: string, filePath: string): ParsedDiff {
  const lines = rawDiff.split('\n');
  const hunks: Hunk[] = [];
  const addedLines: { lineNumber: number; content: string }[] = [];
  const removedLines: { lineNumber: number; content: string }[] = [];

  let oldPath = '';
  let newPath = '';
  let isNewFile = false;
  let isDeletedFile = false;
  let currentHunk: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    const header = parseHeaderLine(line);
    if (header) {
      if (header.side === 'old') {
        oldPath = header.path;
      } else {
        newPath = header.path;
      }
      continue;
    }

    const rangeMatch = RANGE_LINE.exec(line);
    if (rangeMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      const oldStart = parseInt(rangeMatch[1], 10);
      const oldCount = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : 1;
      const newStart = parseInt(rangeMatch[3], 10);
      const newCount = rangeMatch[4] ? parseInt(rangeMatch[4], 10) : 1;
      currentHunk = {
        oldStart,
        oldCount,
        newStart,
        newCount,
        lines: [],
      };
      oldLine = oldStart;
      newLine = newStart;
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith('+')) {
      const hunkLine: HunkLine = {
        type: 'added',
        content: line.slice(1),
        oldLineNumber: null,
        newLineNumber: newLine,
      };
      currentHunk.lines.push(hunkLine);
      addedLines.push({ lineNumber: newLine, content: line.slice(1) });
      newLine++;
    } else if (line.startsWith('-')) {
      const hunkLine: HunkLine = {
        type: 'removed',
        content: line.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: null,
      };
      currentHunk.lines.push(hunkLine);
      removedLines.push({ lineNumber: oldLine, content: line.slice(1) });
      oldLine++;
    } else if (line.startsWith('\\')) {
      continue;
    } else {
      const hunkLine: HunkLine = {
        type: 'context',
        content: line.startsWith(' ') ? line.slice(1) : line,
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      };
      currentHunk.lines.push(hunkLine);
      oldLine++;
      newLine++;
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  if (!newPath || newPath === '/dev/null') {
    isDeletedFile = true;
  }
  if (!oldPath || oldPath === '/dev/null') {
    isNewFile = true;
  }

  return {
    filePath,
    oldPath,
    newPath,
    hunks,
    addedLines,
    removedLines,
    rawDiff,
    isNewFile,
    isDeletedFile,
  };
}
