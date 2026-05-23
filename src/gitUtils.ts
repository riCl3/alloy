import simpleGit from 'simple-git';

export interface GitOptions {
  repoPath?: string;
}

export async function getDiffForFile(filePath: string, options?: GitOptions): Promise<string> {
  const git = simpleGit(options?.repoPath);

  const diff = await git.diff(['HEAD', '--', filePath]);

  return diff;
}

export async function getRepoRoot(filePath: string): Promise<string | null> {
  try {
    const git = simpleGit();
    const root = await git.revparse(['--show-toplevel']);
    return root.trim();
  } catch {
    return null;
  }
}
