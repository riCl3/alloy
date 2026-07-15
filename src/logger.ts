/**
 * Lightweight logger that routes to the VS Code output channel when available,
 * falling back to console for non-VS Code environments (tests, CLI).
 */

let outputChannel: { appendLine: (message: string) => void } | null = null;

export function setOutputChannel(channel: { appendLine: (message: string) => void } | null): void {
  outputChannel = channel;
}

function prefix(level: string): string {
  return `[Alloy] [${level}]`;
}

export const logger = {
  info(message: string): void {
    if (outputChannel) {
      outputChannel.appendLine(`${prefix('INFO')} ${message}`);
    } else {
      console.log(`[Alloy] ${message}`);
    }
  },

  warn(message: string): void {
    if (outputChannel) {
      outputChannel.appendLine(`${prefix('WARN')} ${message}`);
    } else {
      console.warn(`[Alloy] ${message}`);
    }
  },

  error(message: string): void {
    if (outputChannel) {
      outputChannel.appendLine(`${prefix('ERROR')} ${message}`);
    } else {
      console.error(`[Alloy] ${message}`);
    }
  },

  debug(message: string): void {
    if (outputChannel) {
      outputChannel.appendLine(`${prefix('DEBUG')} ${message}`);
    } else {
      console.log(`[Alloy] ${message}`);
    }
  },
};
