import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from './logger';

const DISMISSED_FILENAME = 'ignored-findings.json';

interface DismissStoreData {
  dismissedIds: string[];
}

export class DismissStore {
  private dismissedIds = new Set<string>();
  private workspacePath: string | null = null;

  async initialize(workspacePath: string): Promise<void> {
    this.workspacePath = workspacePath;
    await this.load();
  }

  private storePath(): string | null {
    if (!this.workspacePath) return null;
    return path.join(this.workspacePath, '.alloy', DISMISSED_FILENAME);
  }

  private async load(): Promise<void> {
    const filePath = this.storePath();
    if (!filePath) return;
    try {
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      const data = JSON.parse(Buffer.from(raw).toString('utf-8')) as DismissStoreData;
      if (data && Array.isArray(data.dismissedIds)) {
        this.dismissedIds = new Set(data.dismissedIds);
        logger.info(`DismissStore: loaded ${data.dismissedIds.length} dismissed findings`);
      }
    } catch {
      // File doesn't exist yet — start fresh
      this.dismissedIds = new Set();
    }
  }

  private async save(): Promise<void> {
    const filePath = this.storePath();
    if (!filePath) return;
    try {
      const dir = path.dirname(filePath);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
      const data: DismissStoreData = {
        dismissedIds: Array.from(this.dismissedIds),
      };
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(filePath),
        Buffer.from(JSON.stringify(data, null, 2), 'utf-8'),
      );
    } catch (err) {
      logger.warn(`DismissStore: failed to save: ${(err as Error).message}`);
    }
  }

  isDismissed(findingId: string): boolean {
    return this.dismissedIds.has(findingId);
  }

  async dismiss(findingId: string): Promise<void> {
    this.dismissedIds.add(findingId);
    await this.save();
  }

  async dismissAll(findings: { id?: string }[]): Promise<void> {
    for (const f of findings) {
      if (f.id) this.dismissedIds.add(f.id);
    }
    await this.save();
  }

  async restore(findingId: string): Promise<void> {
    this.dismissedIds.delete(findingId);
    await this.save();
  }

  async clear(): Promise<void> {
    this.dismissedIds.clear();
    await this.save();
  }

  filterDismissed(findings: { id?: string }[]): { id?: string }[] {
    return findings.filter(f => !f.id || !this.dismissedIds.has(f.id));
  }
}

// Singleton instance
let instance: DismissStore | null = null;

export function getDismissStore(): DismissStore {
  if (!instance) {
    instance = new DismissStore();
  }
  return instance;
}
