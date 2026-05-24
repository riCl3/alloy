import { getFunctionContext, formatFunctionContext, detectLanguage, FunctionContext } from '../astContext';

const SAMPLE_TS_CODE = `
function greet(name: string): void {
  console.log(name);
}

class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  private logResult(value: number): void {
    console.log(value);
  }
}

const helper = () => {
  return 42;
};`;

const SAMPLE_JS_CODE = `
function greet(name) {
  console.log(name);
}

function process(data) {
  if (!data) {
    throw new Error('no data');
  }
  return data.map(item => item.value);
}
`;

describe('detectLanguage', () => {
  it('detects TypeScript from .ts extension', () => {
    expect(detectLanguage('src/file.ts')).toBe('typescript');
  });

  it('detects TypeScript from .tsx extension', () => {
    expect(detectLanguage('src/component.tsx')).toBe('typescript');
  });

  it('detects JavaScript from .js extension', () => {
    expect(detectLanguage('src/file.js')).toBe('javascript');
  });

  it('detects JavaScript from .mjs extension', () => {
    expect(detectLanguage('src/file.mjs')).toBe('javascript');
  });

  it('detects JavaScript from .cjs extension', () => {
    expect(detectLanguage('src/file.cjs')).toBe('javascript');
  });

  it('returns null for unknown extensions', () => {
    expect(detectLanguage('src/file.py')).toBeNull();
    expect(detectLanguage('src/file.rs')).toBeNull();
    expect(detectLanguage('file')).toBeNull();
  });
});

describe('getFunctionContext with TypeScript', () => {
  it('finds function containing a line in the function body', async () => {
    // Line 3 is `  console.log(name);` inside greet() (1-based, row 2 is 0-based)
    const contexts = await getFunctionContext(SAMPLE_TS_CODE, [3], 'file.ts');
    expect(contexts).toHaveLength(1);
    expect(contexts[0].name).toBe('greet');
  });

  it('finds function containing a line on the declaration itself', async () => {
    // Line 2 is the `function greet...` declaration (1-based; line 1 is empty from leading newline)
    const contexts = await getFunctionContext(SAMPLE_TS_CODE, [2], 'file.ts');
    expect(contexts).toHaveLength(1);
    expect(contexts[0].name).toBe('greet');
  });

  it('finds a class method containing a modified line', async () => {
    // Line 8 is `return a + b;` inside add() (1-based)
    const contexts = await getFunctionContext(SAMPLE_TS_CODE, [8], 'file.ts');
    expect(contexts).toHaveLength(1);
    expect(contexts[0].name).toBe('add');
    expect(contexts[0].signature).toContain('add');
    expect(contexts[0].signature).toContain('a');
    expect(contexts[0].signature).toContain('b');
  });

  it('finds private class method', async () => {
    // Line 12 is `console.log(value);` inside logResult() (1-based)
    const contexts = await getFunctionContext(SAMPLE_TS_CODE, [12], 'file.ts');
    expect(contexts).toHaveLength(1);
    expect(contexts[0].name).toBe('logResult');
    expect(contexts[0].signature).toContain('logResult');
  });

  it('finds arrow function via variable declarator', async () => {
    // Line 17 is `return 42;` inside helper arrow function (1-based)
    const contexts = await getFunctionContext(SAMPLE_TS_CODE, [17], 'file.ts');
    expect(contexts).toHaveLength(1);
    expect(contexts[0].name).toBe('helper');
    expect(contexts[0].signature).toContain('helper');
  });

  it('returns empty when line is outside any function', async () => {
    // Line 5 is blank line between greet() and class Calculator (1-based)
    const contexts = await getFunctionContext(SAMPLE_TS_CODE, [5], 'file.ts');
    expect(contexts).toHaveLength(0);
  });

  it('returns multiple contexts when multiple lines hit different functions', async () => {
    // Lines 3 (greet body) and 8 (add body) - 1-based
    const contexts = await getFunctionContext(SAMPLE_TS_CODE, [3, 8], 'file.ts');
    const names = contexts.map((c) => c.name).sort();
    expect(names).toEqual(['add', 'greet']);
  });

  it('extracts correct signature for a function declaration', async () => {
    const contexts = await getFunctionContext(SAMPLE_TS_CODE, [2], 'file.ts');
    expect(contexts[0].signature).toBe('function greet(name: string): void');
  });

  it('extracts correct signature for a class method', async () => {
    const contexts = await getFunctionContext(SAMPLE_TS_CODE, [7], 'file.ts');
    expect(contexts[0].signature).toContain('add(a: number, b: number)');
  });

  it('returns empty for unsupported language', async () => {
    const contexts = await getFunctionContext('print("hello")', [0], 'file.py');
    expect(contexts).toHaveLength(0);
  });
});

describe('getFunctionContext with JavaScript', () => {
  it('finds function in JavaScript code', async () => {
    // Line 3 is `console.log(name);` inside greet() (1-based)
    const contexts = await getFunctionContext(SAMPLE_JS_CODE, [3], 'file.js');
    expect(contexts).toHaveLength(1);
    expect(contexts[0].name).toBe('greet');
  });

  it('finds second function in JavaScript', async () => {
    // Line 8 is `throw new Error('no data');` inside process() (1-based)
    const contexts = await getFunctionContext(SAMPLE_JS_CODE, [8], 'file.js');
    expect(contexts).toHaveLength(1);
    expect(contexts[0].name).toBe('process');
  });

  it('extracts signature for JS function', async () => {
    const contexts = await getFunctionContext(SAMPLE_JS_CODE, [6], 'file.js');
    expect(contexts[0].signature).toBe('function process(data)');
  });
});

describe('formatFunctionContext', () => {
  it('formats a single context', () => {
    const contexts: FunctionContext[] = [
      { name: 'foo', signature: 'function foo(x: number): void', startLine: 1, endLine: 5 },
    ];
    const result = formatFunctionContext(contexts);
    expect(result).toContain('Function: foo');
    expect(result).toContain('Signature: function foo(x: number): void');
    expect(result).toContain('Affected functions:');
  });

  it('returns empty string for empty contexts', () => {
    expect(formatFunctionContext([])).toBe('');
  });

  it('formats multiple contexts separated', () => {
    const contexts: FunctionContext[] = [
      { name: 'foo', signature: 'function foo()', startLine: 1, endLine: 3 },
      { name: 'bar', signature: 'function bar()', startLine: 5, endLine: 7 },
    ];
    const result = formatFunctionContext(contexts);
    expect(result).toContain('foo');
    expect(result).toContain('bar');
    expect(result.match(/Function:/g)).toHaveLength(2);
  });
});
