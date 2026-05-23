import { Parser, Language, Node } from 'web-tree-sitter';
import * as fs from 'fs';
import * as path from 'path';

export interface FunctionContext {
  name: string;
  signature: string;
  startLine: number;
  endLine: number;
}

interface LanguageLoader {
  wasmPath: string;
  lang?: Language;
}

let initialized = false;
const languageLoaders = new Map<string, LanguageLoader>();

async function ensureInit(): Promise<void> {
  if (!initialized) {
    const wasmPath = path.resolve(__dirname, '..', 'node_modules', 'web-tree-sitter', 'web-tree-sitter.wasm');
    const wasmBinary = fs.readFileSync(wasmPath);
    await Parser.init({ wasmBinary });
    initialized = true;
  }
}

function getLanguageWasmPath(language: string): string {
  // Resolve relative to the extension root (parent of out/), not the VS Code CWD
  const extensionRoot = path.resolve(__dirname, '..');
  switch (language) {
    case 'typescript':
    case 'tsx':
      return path.join(extensionRoot, 'node_modules', 'tree-sitter-typescript', 'tree-sitter-typescript.wasm');
    case 'javascript':
      return path.join(extensionRoot, 'node_modules', 'tree-sitter-javascript', 'tree-sitter-javascript.wasm');
    default:
      throw new Error(`Unsupported language: ${language}`);
  }
}

export function detectLanguage(filePath: string): string | null {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
    return 'typescript';
  }
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) {
    return 'javascript';
  }
  return null;
}

async function getLanguage(language: string): Promise<Language> {
  let loader = languageLoaders.get(language);
  if (!loader) {
    loader = { wasmPath: getLanguageWasmPath(language) };
    languageLoaders.set(language, loader);
  }
  if (!loader.lang) {
    await ensureInit();
    const wasmBuffer = fs.readFileSync(loader.wasmPath);
    loader.lang = await Language.load(new Uint8Array(wasmBuffer));
  }
  return loader.lang;
}

const FUNCTION_NODE_TYPES = new Set([
  'function_declaration',
  'method_definition',
  'function',
  'arrow_function',
]);

function getFunctionName(node: Node, sourceCode: string): string | null {
  if (node.type === 'arrow_function') {
    const parent = node.parent;
    if (parent && parent.type === 'variable_declarator') {
      const nameNode = parent.childForFieldName('name');
      if (nameNode) {
        return sourceCode.slice(nameNode.startIndex, nameNode.endIndex);
      }
    }
    return null;
  }

  const nameNode = node.childForFieldName('name');
  if (nameNode) {
    return sourceCode.slice(nameNode.startIndex, nameNode.endIndex);
  }
  return null;
}

function extractSignature(node: Node, sourceCode: string): string {
  const bodyNode = node.childForFieldName('body');

  if (node.type === 'arrow_function') {
    const parent = node.parent;
    if (parent && parent.type === 'variable_declarator') {
      const nameNode = parent.childForFieldName('name');
      if (nameNode) {
        const name = sourceCode.slice(nameNode.startIndex, nameNode.endIndex);
        const paramsNode = node.childForFieldName('parameters');
        const params = paramsNode ? sourceCode.slice(paramsNode.startIndex, paramsNode.endIndex) : '()';
        return `function ${name}${params}`;
      }
    }
  }

  if (bodyNode) {
    return sourceCode.slice(node.startIndex, bodyNode.startIndex).trim();
  }

  return sourceCode.slice(node.startIndex, node.endIndex).trim();
}

function findFunctionsInTree(
  node: Node,
  modifiedLines: Set<number>,
  sourceCode: string,
  contexts: FunctionContext[],
): void {
  if (FUNCTION_NODE_TYPES.has(node.type)) {
    for (const line of modifiedLines) {
      if (line >= node.startPosition.row && line <= node.endPosition.row) {
        const name = getFunctionName(node, sourceCode);
        if (name) {
          contexts.push({
            name,
            signature: extractSignature(node, sourceCode),
            startLine: node.startPosition.row,
            endLine: node.endPosition.row,
          });
        }
        break;
      }
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) {
      findFunctionsInTree(child, modifiedLines, sourceCode, contexts);
    }
  }
}

export async function getFunctionContext(
  sourceCode: string,
  modifiedLines: number[],
  filePath: string,
): Promise<FunctionContext[]> {
  const language = detectLanguage(filePath);
  if (!language) {
    return [];
  }

  const lang = await getLanguage(language);
  const parser = new Parser();
  parser.setLanguage(lang);

  const tree = parser.parse(sourceCode);
  if (!tree) {
    return [];
  }

  const root = tree.rootNode;
  const modifiedSet = new Set(modifiedLines);
  const contexts: FunctionContext[] = [];

  findFunctionsInTree(root, modifiedSet, sourceCode, contexts);

  return contexts;
}

export function formatFunctionContext(contexts: FunctionContext[]): string {
  if (contexts.length === 0) {
    return '';
  }

  const parts = contexts.map(
    (ctx) => `Function: ${ctx.name}\nSignature: ${ctx.signature}`,
  );

  return `\n\nAffected functions:\n${parts.join('\n\n')}`;
}
