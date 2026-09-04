import * as path from 'path';
import * as vscode from 'vscode';
import { FindingCategory, ReviewFinding, Severity } from './types';

type TreeNode = SummaryNode | FileNode | FindingNode | GroupNode;

interface SummaryNode {
  type: 'summary';
  errors: number;
  warnings: number;
  infos: number;
  total: number;
}

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

const CATEGORY_LABELS: Record<FindingCategory, string> = {
  security: 'Security',
  logic: 'Logic',
  quality: 'Quality',
  performance: 'Performance',
  test: 'Test',
};

const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'info'];
const CATEGORY_ORDER: FindingCategory[] = ['security', 'logic', 'quality', 'performance', 'test'];

export class AlloyFindingsTree implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly findingsChangedEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeFindings = this.findingsChangedEmitter.event;
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
    this.findingsChangedEmitter.fire();
  }

  storeFindings(uri: vscode.Uri, findings: ReviewFinding[]): void {
    this.setFindings(uri, findings);
  }

  getFindings(uri: vscode.Uri): ReviewFinding[] {
    return this.findingsByUri.get(uri.toString())?.findings ?? [];
  }

  getAllFindingsMap(): Map<string, ReviewFinding[]> {
    const result = new Map<string, ReviewFinding[]>();
    for (const [key, entry] of this.findingsByUri) {
      result.set(key, [...entry.findings]);
    }
    return result;
  }

  clearFindings(uri: vscode.Uri): void {
    this.clear(uri);
  }

  clear(uri?: vscode.Uri): void {
    if (uri) {
      this.findingsByUri.delete(uri.toString());
    } else {
      this.findingsByUri.clear();
    }
    this.emitter.fire();
    this.findingsChangedEmitter.fire();
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

  // ─── TreeDataProvider ─────────────────────────────────────────

  getTreeItem(element: TreeNode): vscode.TreeItem {
    switch (element.type) {
      case 'summary':
        return this.getSummaryTreeItem(element);
      case 'file':
        return this.getFileTreeItem(element);
      case 'group':
        return this.getGroupTreeItem(element);
      case 'finding':
        return this.getFindingTreeItem(element);
    }
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this.getRootChildren();
    }
    if (element.type === 'summary') {
      return [];
    }
    if (element.type === 'file') {
      return this.getFileChildren(element);
    }
    if (element.type === 'group') {
      return this.getGroupChildren(element);
    }
    return [];
  }

  // ─── Summary node ─────────────────────────────────────────────

  private getSummaryTreeItem(node: SummaryNode): vscode.TreeItem {
    const parts: string[] = [];
    if (node.errors > 0) parts.push(`${node.errors} error${node.errors > 1 ? 's' : ''}`);
    if (node.warnings > 0) parts.push(`${node.warnings} warning${node.warnings > 1 ? 's' : ''}`);
    if (node.infos > 0) parts.push(`${node.infos} info`);

    const label = node.total === 0
      ? 'No issues found'
      : `${node.total} issue${node.total > 1 ? 's' : ''}: ${parts.join(', ')}`;

    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = node.total === 0
      ? new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'))
      : node.errors > 0
        ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconFailed'))
        : new vscode.ThemeIcon('info', new vscode.ThemeColor('testing.iconSkipped'));
    item.contextValue = 'alloySummary';
    item.description = this.groupBy !== 'file' ? `grouped by ${this.groupBy}` : undefined;
    return item;
  }

  // ─── File nodes ───────────────────────────────────────────────

  private getFileTreeItem(element: FileNode): vscode.TreeItem {
    const basename = path.basename(element.uri.fsPath);
    const dirname = path.dirname(element.uri.fsPath);
    const shortDir = dirname.split(/[/\\]/).pop() ?? dirname;

    const item = new vscode.TreeItem(
      basename,
      vscode.TreeItemCollapsibleState.Expanded,
    );
    item.description = `${element.findings.length} · ${shortDir}`;
    item.resourceUri = element.uri;
    item.contextValue = 'alloyFile';

    // Show severity icon based on worst finding
    const hasError = element.findings.some(f => f.severity === 'error');
    const hasWarning = element.findings.some(f => f.severity === 'warning');
    item.iconPath = hasError
      ? SEVERITY_ICONS.error
      : hasWarning
        ? SEVERITY_ICONS.warning
        : SEVERITY_ICONS.info;

    return item;
  }

  // ─── Group nodes ──────────────────────────────────────────────

  private getGroupTreeItem(element: GroupNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      `${element.label} (${element.findings.length})`,
      vscode.TreeItemCollapsibleState.Expanded,
    );
    item.iconPath = element.icon;
    item.contextValue = 'alloyGroup';
    return item;
  }

  // ─── Finding nodes (the richest UI element) ───────────────────

  private getFindingTreeItem(element: FindingNode): vscode.TreeItem {
    const f = element.finding;

    // Build a compact label with category badge
    const categoryLabel = f.category ? `[${CATEGORY_LABELS[f.category]}] ` : '';
    const label = `${categoryLabel}${f.message}`;

    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = SEVERITY_ICONS[f.severity] ?? SEVERITY_ICONS.warning;
    item.description = `line ${f.line}${f.confidence ? ` · ${f.confidence}` : ''}`;
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
    md.isTrusted = false;

    // Severity badge
    const severityEmoji = f.severity === 'error' ? '🔴' : f.severity === 'warning' ? '🟡' : '🔵';
    md.appendMarkdown(`${severityEmoji} **${f.severity.toUpperCase()}**`);

    // Category tag
    if (f.category) {
      md.appendMarkdown(` · ${CATEGORY_LABELS[f.category]}`);
    }

    md.appendMarkdown(`\n\n`);

    // Line number
    md.appendMarkdown(`📍 **Line ${f.line}**`);
    if (f.confidence) {
      md.appendMarkdown(` · Confidence: **${f.confidence}**`);
    }
    md.appendMarkdown(`\n\n---\n\n`);

    // Message
    md.appendMarkdown(`**Issue**\n\n${f.message}\n\n`);

    // Suggestion
    if (f.suggestion) {
      md.appendMarkdown(`💡 **Suggestion**\n\n${f.suggestion}\n\n`);
    }

    // Rationale
    if (f.rationale) {
      md.appendMarkdown(`📝 **Why**\n\n${f.rationale}\n\n`);
    }

    // Replacement preview
    if (f.replacement) {
      md.appendMarkdown(`🔧 **Proposed fix**\n\n`);
      md.appendCodeblock(f.replacement, 'typescript');
    }

    return md;
  }

  // ─── Root children (with summary) ─────────────────────────────

  private getRootChildren(): TreeNode[] {
    const allFindings: { uri: vscode.Uri; finding: ReviewFinding }[] = [];
    for (const entry of this.findingsByUri.values()) {
      for (const finding of entry.findings) {
        allFindings.push({ uri: entry.uri, finding });
      }
    }

    // Always show summary at the top
    const errors = allFindings.filter(f => f.finding.severity === 'error').length;
    const warnings = allFindings.filter(f => f.finding.severity === 'warning').length;
    const infos = allFindings.filter(f => f.finding.severity === 'info').length;
    const summary: SummaryNode = {
      type: 'summary',
      errors,
      warnings,
      infos,
      total: allFindings.length,
    };

    if (allFindings.length === 0) {
      return [summary];
    }

    switch (this.groupBy) {
      case 'severity':
        return [summary, ...this.groupBySeverity(allFindings)];
      case 'category':
        return [summary, ...this.groupByCategory(allFindings)];
      default:
        return [summary, ...this.groupByFile()];
    }
  }

  private groupByFile(): FileNode[] {
    const nodes: FileNode[] = [];
    for (const entry of this.findingsByUri.values()) {
      nodes.push({ type: 'file', uri: entry.uri, findings: entry.findings });
    }
    // Sort by filename
    nodes.sort((a, b) => path.basename(a.uri.fsPath).localeCompare(path.basename(b.uri.fsPath)));
    return nodes;
  }

  private getFileChildren(fileNode: FileNode): FindingNode[] {
    // Sort by severity (errors first), then line number
    const sorted = [...fileNode.findings].sort((a, b) => {
      const sevDiff = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
      if (sevDiff !== 0) return sevDiff;
      return a.line - b.line;
    });
    return sorted.map(f => ({
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
        label: CATEGORY_LABELS[c],
        icon: new vscode.ThemeIcon(CATEGORY_ICONS[c]),
        findings: groups.get(c)!.map(i => i.finding),
      }));
  }

  private getGroupChildren(groupNode: GroupNode): FindingNode[] {
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
