import { parseUnifiedDiff, ParsedDiff } from '../diffParser';

describe('parseUnifiedDiff', () => {
  it('parses a simple diff with added and removed lines', () => {
    const rawDiff = [
      '--- a/src/file.ts',
      '+++ b/src/file.ts',
      '@@ -1,5 +1,6 @@',
      ' line1',
      ' line2',
      '-old line',
      '+new line',
      ' line3',
      '+another new line',
    ].join('\n');

    const result = parseUnifiedDiff(rawDiff, 'src/file.ts');

    expect(result.filePath).toBe('src/file.ts');
    expect(result.oldPath).toBe('src/file.ts');
    expect(result.newPath).toBe('src/file.ts');
    expect(result.isNewFile).toBe(false);
    expect(result.isDeletedFile).toBe(false);
    expect(result.hunks).toHaveLength(1);
    expect(result.addedLines).toHaveLength(2);
    expect(result.removedLines).toHaveLength(1);

    expect(result.addedLines[0]).toEqual({ lineNumber: 3, content: 'new line' });
    expect(result.addedLines[1]).toEqual({ lineNumber: 5, content: 'another new line' });
    expect(result.removedLines[0]).toEqual({ lineNumber: 3, content: 'old line' });
  });

  it('parses a new file diff', () => {
    const rawDiff = [
      '--- /dev/null',
      '+++ b/src/newfile.ts',
      '@@ -0,0 +1,3 @@',
      '+import { foo } from "./foo";',
      '+',
      '+export const bar = foo();',
    ].join('\n');

    const result = parseUnifiedDiff(rawDiff, 'src/newfile.ts');

    expect(result.isNewFile).toBe(true);
    expect(result.isDeletedFile).toBe(false);
    expect(result.oldPath).toBe('/dev/null');
    expect(result.newPath).toBe('src/newfile.ts');
    expect(result.addedLines).toHaveLength(3);
    expect(result.removedLines).toHaveLength(0);
  });

  it('parses a deleted file diff', () => {
    const rawDiff = [
      '--- a/src/oldfile.ts',
      '+++ /dev/null',
      '@@ -1,3 +0,0 @@',
      '-const x = 1;',
      '-const y = 2;',
      '-const z = 3;',
    ].join('\n');

    const result = parseUnifiedDiff(rawDiff, 'src/oldfile.ts');

    expect(result.isNewFile).toBe(false);
    expect(result.isDeletedFile).toBe(true);
    expect(result.oldPath).toBe('src/oldfile.ts');
    expect(result.newPath).toBe('/dev/null');
    expect(result.addedLines).toHaveLength(0);
    expect(result.removedLines).toHaveLength(3);
  });

  it('parses a diff with no changes (empty diff)', () => {
    const result = parseUnifiedDiff('', 'src/file.ts');

    expect(result.filePath).toBe('src/file.ts');
    expect(result.hunks).toHaveLength(0);
    expect(result.addedLines).toHaveLength(0);
    expect(result.removedLines).toHaveLength(0);
  });

  it('parses a diff with multiple hunks', () => {
    const rawDiff = [
      '--- a/src/file.ts',
      '+++ b/src/file.ts',
      '@@ -1,3 +1,4 @@',
      ' line1',
      ' line2',
      '+inserted',
      ' line3',
      '@@ -10,5 +11,6 @@',
      ' line10',
      '-remove me',
      '+replaced',
      ' line11',
      ' line12',
      '+extra',
    ].join('\n');

    const result = parseUnifiedDiff(rawDiff, 'src/file.ts');

    expect(result.hunks).toHaveLength(2);

    expect(result.hunks[0].oldStart).toBe(1);
    expect(result.hunks[0].newStart).toBe(1);
    expect(result.hunks[1].oldStart).toBe(10);
    expect(result.hunks[1].newStart).toBe(11);

    expect(result.addedLines).toHaveLength(3);
    expect(result.removedLines).toHaveLength(1);
  });

  it('correctly tracks line numbers for added lines', () => {
    const rawDiff = [
      '--- a/src/file.ts',
      '+++ b/src/file.ts',
      '@@ -5,7 +5,9 @@',
      ' unchanged',
      ' unchanged',
      '-bad code',
      '+good code',
      ' unchanged',
      '+new feature',
      '+another feature',
      ' unchanged',
      ' unchanged',
    ].join('\n');

    const result = parseUnifiedDiff(rawDiff, 'src/file.ts');

    expect(result.addedLines).toHaveLength(3);
    expect(result.addedLines[0].lineNumber).toBe(7);
    expect(result.addedLines[0].content).toBe('good code');
    expect(result.addedLines[1].lineNumber).toBe(9);
    expect(result.addedLines[1].content).toBe('new feature');
    expect(result.addedLines[2].lineNumber).toBe(10);
    expect(result.addedLines[2].content).toBe('another feature');

    expect(result.removedLines).toHaveLength(1);
    expect(result.removedLines[0].lineNumber).toBe(7);
    expect(result.removedLines[0].content).toBe('bad code');
  });

  it('handles no-newline-at-eof markers', () => {
    const rawDiff = [
      '--- a/src/file.ts',
      '+++ b/src/file.ts',
      '@@ -1,3 +1,4 @@',
      ' line1',
      ' line2',
      '+line3',
      '\\ No newline at end of file',
    ].join('\n');

    const result = parseUnifiedDiff(rawDiff, 'src/file.ts');

    expect(result.hunks).toHaveLength(1);
    expect(result.addedLines).toHaveLength(1);
    expect(result.removedLines).toHaveLength(0);
  });

  it('preserves rawDiff in output', () => {
    const rawDiff = [
      '--- a/src/file.ts',
      '+++ b/src/file.ts',
      '@@ -1,1 +1,1 @@',
      '-a',
      '+b',
    ].join('\n');

    const result = parseUnifiedDiff(rawDiff, 'src/file.ts');

    expect(result.rawDiff).toBe(rawDiff);
  });

  it('handles diff with commit header lines', () => {
    const rawDiff = [
      'diff --git a/src/file.ts b/src/file.ts',
      'index abc123..def456 100644',
      '--- a/src/file.ts',
      '+++ b/src/file.ts',
      '@@ -1,2 +1,3 @@',
      ' keep',
      '-remove',
      '+replace',
      '+extra',
    ].join('\n');

    const result = parseUnifiedDiff(rawDiff, 'src/file.ts');

    expect(result.addedLines).toHaveLength(2);
    expect(result.removedLines).toHaveLength(1);
  });

  it('parses diff for a renamed file with similar content', () => {
    const rawDiff = [
      'diff --git a/src/old.ts b/src/new.ts',
      'similarity index 100%',
      'rename from src/old.ts',
      'rename to src/new.ts',
      '--- a/src/old.ts',
      '+++ b/src/new.ts',
      '@@ -1,1 +1,1 @@',
      '-old content',
      '+new content',
    ].join('\n');

    const result = parseUnifiedDiff(rawDiff, 'src/new.ts');

    expect(result.oldPath).toBe('src/old.ts');
    expect(result.newPath).toBe('src/new.ts');
    expect(result.addedLines).toHaveLength(1);
    expect(result.removedLines).toHaveLength(1);
    expect(result.addedLines[0].content).toBe('new content');
    expect(result.removedLines[0].content).toBe('old content');
  });
});
