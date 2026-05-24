import * as path from 'path';
import simpleGit from 'simple-git';

export interface GitOptions {
  repoPath?: string;
}

export async function getDiffForFile(filePath: string, options?: GitOptions): Promise<string> {
  const git = simpleGit(options?.repoPath).env('GIT_OPTIONAL_LOCKS', '0');

  try {
    return await git.diff(['HEAD', '--', filePath]);
  } catch {
    // Fallback: diff unstaged changes only (avoids index lock issues)
    return await git.diff(['--', filePath]);
  }
}

export async function getHeadContent(filePath: string, options?: GitOptions): Promise<string | null> {
  const git = simpleGit(options?.repoPath).env('GIT_OPTIONAL_LOCKS', '0');
  try {
    const relativePath = path.relative(options?.repoPath ?? '.', filePath).replace(/\\/g, '/');
    return await git.show([`HEAD:${relativePath}`]);
  } catch {
    return null; // file is new, doesn't exist in HEAD
  }
}
