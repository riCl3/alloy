export interface SampleDiff {
  name: string;
  filePath: string;
  diff: string;
  modifiedLines: number[];
  expectedFindings: ExpectedFinding[];
}

export interface ExpectedFinding {
  line: number;
  category: 'security' | 'logic' | 'quality' | 'performance' | 'test';
  severity: 'error' | 'warning' | 'info';
  description: string;
}

export const sampleDiffs: SampleDiff[] = [
  {
    name: 'SQL injection vulnerability',
    filePath: 'src/db/users.ts',
    diff: `--- a/src/db/users.ts
+++ b/src/db/users.ts
@@ -10,6 +10,12 @@ import { Database } from './connection';
 export async function findUser(username: string) {
   const db = await Database.connect();
-  const result = await db.query('SELECT * FROM users WHERE username = ?', [username]);
+  const query = \`SELECT * FROM users WHERE username = '\${username}'\`;
+  const result = await db.query(query);
   return result.rows[0];
 }
+
+export async function deleteUser(username: string) {
+  const db = await Database.connect();
+  const query = \`DELETE FROM users WHERE username = '\${username}'\`;
+  await db.query(query);
 }`,
    modifiedLines: [11, 12, 15, 16],
    expectedFindings: [
      { line: 11, category: 'security', severity: 'error', description: 'SQL injection via template literal' },
      { line: 16, category: 'security', severity: 'error', description: 'SQL injection via template literal' },
    ],
  },
  {
    name: 'Unhandled null reference',
    filePath: 'src/utils/parse.ts',
    diff: `--- a/src/utils/parse.ts
+++ b/src/utils/parse.ts
@@ -5,8 +5,14 @@ interface Config {
 }
 
 export function parseConfig(raw: string): Config {
-  const data = JSON.parse(raw);
-  return { host: data.host, port: data.port };
+  const data = JSON.parse(raw) as Config | null;
+  return {
+    host: data.host,
+    port: data.port,
+    timeout: data.options.timeout,
+  };
 }
+
+export function getHost(config: Config): string {
+  return config.host.toUpperCase();
 }`,
    modifiedLines: [8, 9, 10, 11, 12, 16],
    expectedFindings: [
      { line: 11, category: 'logic', severity: 'error', description: 'Potential null dereference on data.options' },
    ],
  },
  {
    name: 'Missing error handling',
    filePath: 'src/api/fetch.ts',
    diff: `--- a/src/api/fetch.ts
+++ b/src/api/fetch.ts
@@ -3,9 +3,15 @@ const API_BASE = 'https://api.example.com';
 
 export async function fetchData<T>(endpoint: string): Promise<T> {
   const url = \`\${API_BASE}\${endpoint}\`;
-  const response = await fetch(url);
-  const data = await response.json();
-  return data as T;
+  const response = await fetch(url);
+  const data = await response.json();
+  return data as T;
+}
+
+export async function fetchWithRetry<T>(endpoint: string, retries = 3): Promise<T> {
+  for (let i = 0; i < retries; i++) {
+    return await fetchData<T>(endpoint);
+  }
+  throw new Error('Failed');
 }`,
    modifiedLines: [6, 7, 8, 12, 13, 14],
    expectedFindings: [
      { line: 6, category: 'quality', severity: 'warning', description: 'No error handling for fetch failure' },
      { line: 13, category: 'logic', severity: 'warning', description: 'Retry loop always returns on first iteration' },
    ],
  },
  {
    name: 'N+1 query pattern',
    filePath: 'src/db/orders.ts',
    diff: `--- a/src/db/orders.ts
+++ b/src/db/orders.ts
@@ -8,6 +8,18 @@ interface Order {
   items: OrderItem[];
 }
 
+export async function getOrdersWithItems(): Promise<Order[]> {
+  const db = await Database.connect();
+  const orders = await db.query('SELECT * FROM orders');
+
+  for (const order of orders.rows) {
+    const items = await db.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
+    order.items = items.rows;
+  }
+
+  return orders.rows;
+}`,
    modifiedLines: [11, 12, 13, 14, 15, 16, 17, 18, 19],
    expectedFindings: [
      { line: 14, category: 'performance', severity: 'warning', description: 'N+1 query: query inside loop' },
    ],
  },
  {
    name: 'Missing test coverage',
    filePath: 'src/math/calculate.ts',
    diff: `--- a/src/math/calculate.ts
+++ b/src/math/calculate.ts
@@ -1,5 +1,15 @@
 export function divide(a: number, b: number): number {
+  if (b === 0) {
+    throw new Error('Division by zero');
+  }
   return a / b;
 }
+
+export function average(numbers: number[]): number {
+  if (numbers.length === 0) return 0;
+  const sum = numbers.reduce((acc, n) => acc + n, 0);
+  return sum / numbers.length;
+}`,
    modifiedLines: [2, 3, 4, 8, 9, 10, 11],
    expectedFindings: [
      { line: 8, category: 'test', severity: 'info', description: 'Missing test for empty array edge case' },
    ],
  },
  {
    name: 'Race condition',
    filePath: 'src/state/counter.ts',
    diff: `--- a/src/state/counter.ts
+++ b/src/state/counter.ts
@@ -5,6 +5,14 @@ let counter = 0;
 
 export function increment(): number {
-  counter++;
-  return counter;
+  const current = counter;
+  counter = current + 1;
+  return counter;
+}
+
+export async function batchIncrement(n: number): Promise<void> {
+  for (let i = 0; i < n; i++) {
+    increment();
+  }
 }`,
    modifiedLines: [8, 9, 10, 13, 14, 15],
    expectedFindings: [
      { line: 8, category: 'security', severity: 'warning', description: 'Race condition: read-then-write without atomicity' },
    ],
  },
  {
    name: 'Memory leak potential',
    filePath: 'src/events/handler.ts',
    diff: `--- a/src/events/handler.ts
+++ b/src/events/handler.ts
@@ -5,6 +5,18 @@ const handlers = new Map<string, Function[]>();
 
 export function on(event: string, handler: Function): void {
-  const existing = handlers.get(event) ?? [];
-  existing.push(handler);
-  handlers.set(event, existing);
+  const existing = handlers.get(event) ?? [];
+  existing.push(handler);
+  handlers.set(event, existing);
+}
+
+export function createEmitter() {
+  const emitter = {
+    listeners: new Set<Function>(),
+    subscribe(fn: Function) {
+      this.listeners.add(fn);
+    },
+  };
+  return emitter;
 }`,
    modifiedLines: [8, 9, 10, 13, 14, 15, 16, 17],
    expectedFindings: [
      { line: 16, category: 'performance', severity: 'warning', description: 'No unsubscribe mechanism - potential memory leak' },
    ],
  },
  {
    name: 'Incorrect type coercion',
    filePath: 'src/utils/validate.ts',
    diff: `--- a/src/utils/validate.ts
+++ b/src/utils/validate.ts
@@ -3,6 +3,14 @@ export function isEmail(value: string): boolean {
   return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value);
 }
 
+export function isNumeric(value: string): boolean {
+  return !isNaN(value as unknown as number);
+}
+
+export function isEmpty(value: unknown): boolean {
+  return value == null || value == '';
+}`,
    modifiedLines: [6, 7, 10, 11],
    expectedFindings: [
      { line: 7, category: 'logic', severity: 'warning', description: 'Unsafe type coercion with isNaN' },
      { line: 11, category: 'logic', severity: 'info', description: 'Loose equality with == instead of ===' },
    ],
  },
  {
    name: 'Deprecated API usage',
    filePath: 'src/api/client.ts',
    diff: `--- a/src/api/client.ts
+++ b/src/api/client.ts
@@ -5,6 +5,14 @@ const client = new HttpClient();
 
 export async function getData(url: string) {
-  return client.get(url);
+  const response = await fetch(url);
+  return response.json();
+}
+
+export function formatDate(date: Date): string {
+  return date.toLocaleDateString();
+}
+
+export function parseUrl(raw: string): URL {
+  return new URL(raw);
 }`,
    modifiedLines: [7, 8, 11, 12, 15, 16],
    expectedFindings: [
      { line: 12, category: 'quality', severity: 'info', description: 'toLocaleDateString is locale-dependent' },
    ],
  },
  {
    name: 'Missing input validation',
    filePath: 'src/auth/login.ts',
    diff: `--- a/src/auth/login.ts
+++ b/src/auth/login.ts
@@ -5,6 +5,16 @@ interface Credentials {
 
 export async function login(credentials: Credentials): Promise<User> {
-  // existing login logic
+  const { username, password } = credentials;
+  const user = await db.findUser(username);
+  if (!user) throw new Error('User not found');
+  const valid = await bcrypt.compare(password, user.hash);
+  if (!valid) throw new Error('Invalid password');
+  return user;
+}
+
+export async function resetPassword(email: string, newPassword: string) {
+  await db.updatePassword(email, newPassword);
 }`,
    modifiedLines: [8, 9, 10, 11, 12, 15, 16],
    expectedFindings: [
      { line: 15, category: 'security', severity: 'error', description: 'No validation on newPassword strength' },
      { line: 16, category: 'security', severity: 'warning', description: 'No rate limiting on password reset' },
    ],
  },
];

export function buildGoldenDatasetSummary(): string {
  const totalFindings = sampleDiffs.reduce((sum, d) => sum + d.expectedFindings.length, 0);
  const byCategory = {
    security: sampleDiffs.flatMap((d) => d.expectedFindings).filter((f) => f.category === 'security').length,
    logic: sampleDiffs.flatMap((d) => d.expectedFindings).filter((f) => f.category === 'logic').length,
    quality: sampleDiffs.flatMap((d) => d.expectedFindings).filter((f) => f.category === 'quality').length,
    performance: sampleDiffs.flatMap((d) => d.expectedFindings).filter((f) => f.category === 'performance').length,
    test: sampleDiffs.flatMap((d) => d.expectedFindings).filter((f) => f.category === 'test').length,
  };

  return [
    `Golden Dataset: ${sampleDiffs.length} diffs, ${totalFindings} expected findings`,
    `  security: ${byCategory.security}`,
    `  logic: ${byCategory.logic}`,
    `  quality: ${byCategory.quality}`,
    `  performance: ${byCategory.performance}`,
    `  test: ${byCategory.test}`,
  ].join('\n');
}
