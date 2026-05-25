import * as path from 'path';
import * as vscode from 'vscode';
import { ReviewFinding } from './types';

type TreeNode = FileNode | FindingNode;

interface FileNode {
  type: 'file';
  uri: vscode.Uri;
  findings: ReviewFinding[];
}

interface FindingNode {
  type: 'finding';
  uri: vscode.Uri;
  finding: ReviewFinding;
}

export class AlloyFindingsTree implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly findingsByUri = new Map<string, { uri: vscode.Uri; findings: ReviewFinding[] }>();

  setFindings(uri: vscode.Uri, findings: ReviewFinding[]): void {
    if (findings.length === 0) {
      this.findingsByUri.delete(uri.toString());
    } else {
      this.findingsByUri.set(uri.toString(), { uri, findings });
    }
    this.emitter.fire();
  }

  clear(uri?: vscode.Uri): void {
    if (uri) {
      this.findingsByUri.delete(uri.toString());
    } else {
      this.findingsByUri.clear();
    }
    this.emitter.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.type === 'file') {
      const item = new vscode.TreeItem(
        `${path.basename(element.uri.fsPath)} (${element.findings.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.description = path.dirname(element.uri.fsPath);
      item.resourceUri = element.uri;
      return item;
    }

    const label = `[${element.finding.severity}] ${element.finding.message}`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = element.finding.category;
    item.tooltip = element.finding.suggestion;
    item.command = {
      command: 'vscode.open',
      title: 'Open finding',
      arguments: [
        element.uri,
        {
          selection: new vscode.Range(Math.max(0, element.finding.line - 1), 0, Math.max(0, element.finding.line - 1), 0),
        },
      ],
    };
    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return [...this.findingsByUri.values()]
        .sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath))
        .map((entry) => ({ type: 'file', uri: entry.uri, findings: entry.findings }));
    }
    if (element.type === 'file') {
      return element.findings.map((finding) => ({ type: 'finding', uri: element.uri, finding }));
    }
    return [];
  }
}
