import { shouldSkipPath, clearIgnoreCache, isSupportedSourceFile } from '../ignore';
import { promises as fsp } from 'fs';

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      stat: jest.fn(),
      readFile: jest.fn(),
    },
  };
});

const mockStat = fsp.stat as jest.Mock;
const mockReadFile = fsp.readFile as jest.Mock;

describe('ignore', () => {
  beforeEach(() => {
    clearIgnoreCache();
    mockStat.mockReset();
    mockReadFile.mockReset();
  });

  it('skips node_modules', async () => {
    expect(await shouldSkipPath('/repo/node_modules/pkg/index.ts', '/repo')).toBe(true);
  });

  it('skips dist directory', async () => {
    expect(await shouldSkipPath('/repo/dist/bundle.js', '/repo')).toBe(true);
  });

  it('does not skip normal source files', async () => {
    expect(await shouldSkipPath('/repo/src/app.ts', '/repo')).toBe(false);
  });

  it('skips configured patterns', async () => {
    expect(await shouldSkipPath('/repo/src/generated/client.ts', '/repo', ['src/generated/**'])).toBe(true);
  });

  it('loads .alloyignore patterns', async () => {
    mockStat.mockResolvedValue({ mtimeMs: 1000 });
    mockReadFile.mockResolvedValue('*.test.ts\nbuild/\n');

    expect(await shouldSkipPath('/repo/src/app.test.ts', '/repo')).toBe(true);
    expect(await shouldSkipPath('/repo/build/output.js', '/repo')).toBe(true);
    expect(await shouldSkipPath('/repo/src/app.ts', '/repo')).toBe(false);
  });

  it('caches .alloyignore by mtime', async () => {
    mockStat.mockResolvedValue({ mtimeMs: 1000 });
    mockReadFile.mockResolvedValue('*.test.ts\n');

    await shouldSkipPath('/repo/src/app.test.ts', '/repo');
    await shouldSkipPath('/repo/src/other.test.ts', '/repo');

    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it('identifies supported source files', () => {
    expect(isSupportedSourceFile('/repo/src/app.ts')).toBe(true);
    expect(isSupportedSourceFile('/repo/src/app.tsx')).toBe(true);
    expect(isSupportedSourceFile('/repo/src/app.js')).toBe(true);
    expect(isSupportedSourceFile('/repo/src/app.json')).toBe(false);
    expect(isSupportedSourceFile('/repo/src/app.css')).toBe(false);
  });
});
