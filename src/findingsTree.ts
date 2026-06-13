import * as path from 'path';
import * as vscode from 'vscode';
import { FindingCategory, ReviewFinding, Severity } from './types';

type TreeNode = FileNode | FindingNode | GroupNode;

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

interface GroupNode {
  type: 'group';
  label: string;
  icon: vscode.ThemeIcon;
  findings: ReviewFinding[];
  uri?: vscode.Uri;
}

export type GroupByMode = 'file' | 'severity' | 'category';

const SEVERITY_ICONS: Record<Severity, vscode.ThemeIcon> = {
  error: new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed')),
  warning: new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconSkipped')),
  info: new vscode.ThemeIcon('info', new vscode.ThemeColor('testing.iconPassed')),
};

const CATEGORY_ICONS: Record<FindingCategory, string> = {
  security: 'shield',
  logic: 'lightbulb',
  quality: 'symbol-method',
  performance: 'zap',
  test: 'beaker',
};

const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'info'];
const CATEGORY_ORDER: FindingCategory[] = ['security', 'logic', 'quality', 'performance', 'test'];

export class AlloyFindingsTree implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly findingsByUri = new Map<string, { uri: vscode.Uri; findings: ReviewFinding[] }>();
  private groupBy: GroupByMode = 'file';

  setGroupBy(mode: GroupByMode): void {
    this.groupBy = mode;
    this.emitter.fire();
  }

  getGroupBy(): GroupByMode {
    return this.groupBy;
  }

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

  dismissFinding(uri: vscode.Uri, findingId: string): void {
    const entry = this.findingsByUri.get(uri.toString());
    if (!entry) return;
    entry.findings = entry.findings.filter(f => f.id !== findingId);
    if (entry.findings.length === 0) {
      this.findingsByUri.delete(uri.toString());
    }
    this.emitter.fire();
  }

  dismissAllInFile(uri: vscode.Uri): void {
    this.findingsByUri.delete(uri.toString());
    this.emitter.fire();
  }

  getAllFindings(): { uri: vscode.Uri; finding: ReviewFinding }[] {
    const result: { uri: vscode.Uri; finding: ReviewFinding }[] = [];
    for (const entry of this.findingsByUri.values()) {
      for (const finding of entry.findings) {
        result.push({ uri: entry.uri, finding });
      }
    }
    return result;
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.type === 'file') {
      return this.getFileTreeItem(element);
    }
    if (element.type === 'group') {
      return this.getGroupTreeItem(element);
    }
    return this.getFindingTreeItem(element);
  }

  private getFileTreeItem(element: FileNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      `${path.basename(element.uri.fsPath)} (${element.findings.length})`,
      vscode.TreeItemCollapsibleState.Expanded,
    );
    item.description = path.dirname(element.uri.fsPath);
    item.resourceUri = element.uri;
    item.contextValue = 'alloyFile';
    return item;
  }

  private getGroupTreeItem(element: GroupNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      `${element.label} (${element.findings.length})`,
      vscode.TreeItemCollapsibleState.Expanded,
    );
    item.iconPath = element.icon;
    item.contextValue = 'alloyGroup';
    return item;
  }

  private getFindingTreeItem(element: FindingNode): vscode.TreeItem {
    const f = element.finding;
    const label = f.message;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);

    item.iconPath = SEVERITY_ICONS[f.severity] ?? SEVERITY_ICONS.warning;
    item.description = `line ${f.line}`;
    item.tooltip = this.buildRichTooltip(f);
    item.contextValue = 'alloyFinding';
    item.command = {
      command: 'vscode.open',
      title: 'Open finding',
      arguments: [element.uri, { selection: new vscode.Range(f.line - 1, 0, f.line - 1, 0) }],
    };
    return item;
  }

  private buildRichTooltip(f: ReviewFinding): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**[${f.severity.toUpperCase()}] ${f.category ?? 'general'}**\n\n`);
    md.appendMarkdown(`Line ${f.line}\n\n`);
    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`**Message:** ${f.message}\n\n`);
    if (f.suggestion) {
      md.appendMarkdown(`**Suggestion:** ${f.suggestion}\n\n`);
    }
    if (f.rationale) {
      md.appendMarkdown(`**Rationale:** ${f.rationale}\n\n`);
    }
    if (f.confidence) {
      md.appendMarkdown(`**Confidence:** ${f.confidence}\n`);
    }
    return md;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this.getRootChildren();
    }
    if (element.type === 'file') {
      return this.getFileChildren(element);
    }
    if (element.type === 'group') {
      return this.getGroupChildren(element);
    }
    return [];
  }

  private getRootChildren(): TreeNode[] {
    const allFindings: { uri: vscode.Uri; finding: ReviewFinding }[] = [];
    for (const entry of this.findingsByUri.values()) {
      for (const finding of entry.findings) {
        allFindings.push({ uri: entry.uri, finding });
      }
    }

    if (allFindings.length === 0) return [];

    switch (this.groupBy) {
      case 'severity':
        return this.groupBySeverity(allFindings);
      case 'category':
        return this.groupByCategory(allFindings);
      default:
        return this.groupByFile();
    }
  }

  private groupByFile(): FileNode[] {
    const nodes: FileNode[] = [];
    for (const entry of this.findingsByUri.values()) {
      nodes.push({ type: 'file', uri: entry.uri, findings: entry.findings });
    }
    return nodes;
  }

  private getFileChildren(fileNode: FileNode): FindingNode[] {
    return fileNode.findings.map(f => ({
      type: 'finding' as const,
      uri: fileNode.uri,
      finding: f,
    }));
  }

  private groupBySeverity(all: { uri: vscode.Uri; finding: ReviewFinding }[]): GroupNode[] {
    const groups = new Map<Severity, ReviewFinding[]>();
    for (const s of SEVERITY_ORDER) groups.set(s, []);
    for (const { finding } of all) {
      groups.get(finding.severity)?.push(finding);
    }
    return SEVERITY_ORDER
      .filter(s => (groups.get(s)?.length ?? 0) > 0)
      .map(s => ({
        type: 'group' as const,
        label: `${s.charAt(0).toUpperCase() + s.slice(1)}s`,
        icon: SEVERITY_ICONS[s],
        findings: groups.get(s)!,
      }));
  }

  private groupByCategory(all: { uri: vscode.Uri; finding: ReviewFinding }[]): GroupNode[] {
    const groups = new Map<FindingCategory, { uri: vscode.Uri; finding: ReviewFinding }[]>();
    for (const c of CATEGORY_ORDER) groups.set(c, []);
    for (const item of all) {
      const cat = item.finding.category ?? 'quality';
      groups.get(cat as FindingCategory)?.push(item);
    }
    return CATEGORY_ORDER
      .filter(c => (groups.get(c)?.length ?? 0) > 0)
      .map(c => ({
        type: 'group' as const,
        label: `${c.charAt(0).toUpperCase() + c.slice(1)}`,
        icon: new vscode.ThemeIcon(CATEGORY_ICONS[c]),
        findings: groups.get(c)!.map(i => i.finding),
      }));
  }

  private getGroupChildren(groupNode: GroupNode): FindingNode[] {
    // For group nodes, we need to find the URI for each finding
    // Look up from the store
    return groupNode.findings.map(f => {
      let uri: vscode.Uri | undefined;
      for (const entry of this.findingsByUri.values()) {
        if (entry.findings.includes(f)) {
          uri = entry.uri;
          break;
        }
      }
      return {
        type: 'finding' as const,
        uri: uri ?? vscode.Uri.file('unknown'),
        finding: f,
      };
    });
  }
}
