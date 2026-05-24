import * as vscode from 'vscode';
import { ReviewFinding } from './types';

export class AlloyCommentController {
  private controller: vscode.CommentController;
  private threads = new Map<string, vscode.CommentThread[]>();

  constructor() {
    this.controller = vscode.comments.createCommentController('alloy', 'Alloy Review');
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: () => [],
    };
  }

  setComments(uri: vscode.Uri, findings: ReviewFinding[]): void {
    this.clearComments(uri);
    const uriKey = uri.toString();
    const threads: vscode.CommentThread[] = [];

    for (const f of findings) {
      const line = Math.max(0, f.line - 1);
      const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);

      const bodyText = f.suggestion
        ? `${f.message}\n\n**Suggestion:** ${f.suggestion}`
        : f.message;
      const body = new vscode.MarkdownString(bodyText);
      body.isTrusted = true;

      const comment: vscode.Comment = { body, author: { name: 'Alloy' }, mode: vscode.CommentMode.Preview };
      const thread = this.controller.createCommentThread(uri, range, [comment]);
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
      thread.canReply = false;
      threads.push(thread);
    }

    this.threads.set(uriKey, threads);
  }

  clearComments(uri: vscode.Uri): void {
    const uriKey = uri.toString();
    const existing = this.threads.get(uriKey);
    if (existing) {
      for (const thread of existing) {
        thread.dispose();
      }
      this.threads.delete(uriKey);
    }
  }

  dispose(): void {
    for (const [, threads] of this.threads) {
      for (const thread of threads) {
        thread.dispose();
      }
    }
    this.threads.clear();
    this.controller.dispose();
  }
}
