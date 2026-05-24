import * as vscode from 'vscode';
import { AlloyCommentController } from '../commentController';
import { ReviewFinding } from '../types';

function makeControllerStub() {
  const threadDispose = jest.fn();
  return {
    createCommentThread: jest.fn().mockReturnValue({
      dispose: threadDispose,
      range: undefined,
      uri: undefined,
      comments: [],
      collapsibleState: vscode.CommentThreadCollapsibleState.Collapsed,
      canReply: false,
    }),
    commentingRangeProvider: undefined,
    dispose: jest.fn(),
    _threadDispose: threadDispose,
  };
}

let stub: ReturnType<typeof makeControllerStub>;

describe('AlloyCommentController', () => {
  let controller: AlloyCommentController;

  beforeEach(() => {
    jest.clearAllMocks();
    stub = makeControllerStub();
    (vscode.comments.createCommentController as jest.Mock).mockReturnValue(stub);
    controller = new AlloyCommentController();
    // Reset call count after constructor
    (stub.createCommentThread as jest.Mock).mockClear();
    stub._threadDispose.mockClear();
    stub.dispose.mockClear();
  });

  afterEach(() => {
    controller.dispose();
  });

  it('creates a comment controller with alloy id and label', () => {
    expect(vscode.comments.createCommentController).toHaveBeenCalledWith('alloy', 'Alloy Review');
  });

  it('sets commentingRangeProvider with provideCommentingRanges returning empty array', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const provider = (stub as any).commentingRangeProvider;
    expect(provider).toBeDefined();
    expect(provider.provideCommentingRanges()).toEqual([]);
  });

  it('creates a comment thread for each finding with correct range', () => {
    const findings: ReviewFinding[] = [
      { line: 5, severity: 'error', message: 'SQL injection risk', suggestion: 'Use parameterized queries' },
      { line: 10, severity: 'warning', message: 'Unused variable', suggestion: 'Remove it' },
    ];

    const uri = vscode.Uri.file('/repo/src/file.ts');
    controller.setComments(uri, findings);

    expect(stub.createCommentThread).toHaveBeenCalledTimes(2);

    const firstCall = stub.createCommentThread.mock.calls[0];
    expect(firstCall[0]).toBe(uri);
    expect(firstCall[1].start.line).toBe(4);
    expect(firstCall[1].end.line).toBe(4);

    const secondCall = stub.createCommentThread.mock.calls[1];
    expect(secondCall[0]).toBe(uri);
    expect(secondCall[1].start.line).toBe(9);
    expect(secondCall[1].end.line).toBe(9);
  });

  it('creates comments with message and suggestion in body', () => {
    const findings: ReviewFinding[] = [
      { line: 3, severity: 'error', message: 'Security flaw', suggestion: 'Fix it' },
    ];

    const uri = vscode.Uri.file('/repo/src/file.ts');
    controller.setComments(uri, findings);

    const comment = stub.createCommentThread.mock.calls[0][2][0];
    expect(comment.body.value).toBe('Security flaw\n\n**Suggestion:** Fix it');
    expect(comment.body.isTrusted).toBe(true);
    expect(comment.author.name).toBe('Alloy');
  });

  it('creates comment without suggestion section when suggestion is empty', () => {
    const findings: ReviewFinding[] = [
      { line: 3, severity: 'info', message: 'Consider refactoring', suggestion: '' },
    ];

    const uri = vscode.Uri.file('/repo/src/file.ts');
    controller.setComments(uri, findings);

    const comment = stub.createCommentThread.mock.calls[0][2][0];
    expect(comment.body.value).toBe('Consider refactoring');
  });

  it('sets thread properties correctly', () => {
    const findings: ReviewFinding[] = [
      { line: 7, severity: 'warning', message: 'Issue', suggestion: '' },
    ];

    const uri = vscode.Uri.file('/repo/src/file.ts');
    controller.setComments(uri, findings);

    const thread = stub.createCommentThread.mock.results[0].value;
    expect(thread.collapsibleState).toBe(vscode.CommentThreadCollapsibleState.Collapsed);
    expect(thread.canReply).toBe(false);
  });

  it('disposes old threads when setComments is called again on same URI', () => {
    const findings: ReviewFinding[] = [
      { line: 1, severity: 'error', message: 'First', suggestion: '' },
    ];
    const uri = vscode.Uri.file('/repo/src/file.ts');

    controller.setComments(uri, findings);
    const disposeFirst = stub._threadDispose;

    // Second call should dispose old threads
    controller.setComments(uri, findings);

    expect(disposeFirst).toHaveBeenCalledTimes(1);
  });

  it('clears all threads for a URI on clearComments', () => {
    const findings: ReviewFinding[] = [
      { line: 1, severity: 'error', message: 'Test', suggestion: '' },
    ];
    const uri = vscode.Uri.file('/repo/src/file.ts');

    controller.setComments(uri, findings);
    const disposeFirst = stub._threadDispose;

    controller.clearComments(uri);

    expect(disposeFirst).toHaveBeenCalledTimes(1);
  });

  it('disposes all threads and the underlying controller on dispose', () => {
    const findings: ReviewFinding[] = [
      { line: 1, severity: 'error', message: 'Test', suggestion: '' },
    ];
    const uri = vscode.Uri.file('/repo/src/file.ts');

    controller.setComments(uri, findings);

    controller.dispose();

    expect(stub._threadDispose).toHaveBeenCalledTimes(1);
    expect(stub.dispose).toHaveBeenCalledTimes(1);
  });
});
