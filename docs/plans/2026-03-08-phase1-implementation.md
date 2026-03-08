# Phase 1: Diagnostic Tools + Plugin Conversion — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate 10 MCP tools into 6, add 4 diagnostic tools, convert project to a Claude Code plugin. Ship as v2.0.0.

**Architecture:** Merge list_tables/list_views/list_functions → list_objects, merge describe_table/get_constraints/get_table_stats → describe_table. Add search_objects, get_connections, diagnose_database, get_slow_queries. Wrap with plugin manifest and model-invoked skills.

**Tech Stack:** TypeScript, Kysely, Zod, @modelcontextprotocol/sdk, Jest, testcontainers

---

### Task 1: Consolidate list_tables + list_views + list_functions → list_objects

**Files:**
- Modify: `src/validation.ts:36-80` (replace 3 schemas with 1)
- Modify: `src/tools/list.ts` (replace both functions + add functions logic)
- Modify: `src/tools/functions.ts` (delete file)
- Modify: `src/index.ts:49-101` (update tool registration)
- Modify: `tests/unit/tools/list.test.ts` (rewrite for list_objects)
- Delete: `tests/unit/tools/functions.test.ts`
- Modify: `tests/integration/container.test.ts:41-52,172-324` (update imports and tool calls)

**Step 1: Write the failing test for list_objects**

Create `tests/unit/tools/list-objects.test.ts`:

```typescript
import { describe, test, expect, afterEach, beforeEach } from '@jest/globals';
import { cleanupDatabase } from '../../helpers/cleanup';

jest.mock('kysely', () => ({
  sql: jest.fn(() => ({
    execute: jest.fn(() => Promise.resolve({
      rows: [
        { object_name: 'users', object_type: 'BASE TABLE', schema_name: 'public' },
        { object_name: 'posts', object_type: 'BASE TABLE', schema_name: 'public' }
      ]
    }))
  })),
  Kysely: jest.fn(),
  PostgresDialect: jest.fn()
}));

jest.mock('../../../src/db', () => ({
  getDb: jest.fn(() => ({})),
  closeDb: jest.fn(() => Promise.resolve())
}));

describe('list_objects tool', () => {
  afterEach(async () => {
    await cleanupDatabase();
    jest.clearAllMocks();
  });

  test('should list tables by default', async () => {
    const { listObjectsTool } = await import('../../../src/tools/list');
    const result = await listObjectsTool({ type: 'tables' });
    expect(result.objects).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(Array.isArray(result.objects)).toBe(true);
  });

  test('should accept type parameter for views', async () => {
    const { listObjectsTool } = await import('../../../src/tools/list');
    const result = await listObjectsTool({ type: 'views' });
    expect(result.objects).toBeDefined();
  });

  test('should accept type parameter for functions', async () => {
    const { listObjectsTool } = await import('../../../src/tools/list');
    const result = await listObjectsTool({ type: 'functions' });
    expect(result.objects).toBeDefined();
  });

  test('should default to public schema', async () => {
    const { listObjectsTool } = await import('../../../src/tools/list');
    const result = await listObjectsTool({ type: 'tables' });
    expect(result.objects).toBeDefined();
  });

  test('should reject invalid type', async () => {
    const { listObjectsTool } = await import('../../../src/tools/list');
    const result = await listObjectsTool({ type: 'invalid' });
    expect(result.error).toBeDefined();
  });

  test('should return error for failed queries', async () => {
    const { sql } = await import('kysely');
    const mockSql = sql as jest.MockedFunction<typeof sql>;
    mockSql.mockImplementationOnce(() => ({
      execute: jest.fn(() => Promise.reject(new Error('Database error')))
    } as any));

    const { listObjectsTool } = await import('../../../src/tools/list');
    const result = await listObjectsTool({ type: 'tables' });
    expect(result.error).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern list-objects`
Expected: FAIL — `listObjectsTool` does not exist.

**Step 3: Update validation schema**

In `src/validation.ts`, replace `ListTablesInputSchema`, `ListViewsInputSchema`, `ListFunctionsInputSchema` (lines 36-80) with:

```typescript
export const ListObjectsInputSchema = z.object({
  type: z.enum(['tables', 'views', 'functions']),
  schema: z.string().min(1).max(63)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
    .optional()
});
```

Remove the old type aliases (lines 104, 109, 110) and add:
```typescript
export type ListObjectsInput = z.infer<typeof ListObjectsInputSchema>;
```

**Step 4: Implement list_objects in `src/tools/list.ts`**

Replace the entire file. The new `listObjectsTool` function dispatches to the correct SQL based on `type`:

- `tables`: Query `information_schema.tables WHERE table_type IN ('BASE TABLE', 'VIEW')`
- `views`: Query `information_schema.views`
- `functions`: Query `pg_proc JOIN pg_namespace JOIN pg_language` (move SQL from functions.ts)

Return shape: `{ objects: [{ object_name, object_type, schema_name, details? }], error? }`

For views, `details` = view definition. For functions, `details` = function signature (return type + args).

**Step 5: Delete `src/tools/functions.ts`**

The functions query moves into list.ts.

**Step 6: Update `src/index.ts` tool registration**

Remove the 3 separate tool registrations (list_tables, list_views, list_functions). Add one:

```typescript
{
  name: "list_objects",
  description: "List tables, views, or functions in a schema",
  inputSchema: getInlineSchema(ListObjectsInputSchema, "ListObjectsInput"),
}
```

Remove the 3 `case` blocks in CallToolRequestSchema handler. Add one for `list_objects`.

Update imports: remove `ListTablesInputSchema`, `ListViewsInputSchema`, `ListFunctionsInputSchema`. Add `ListObjectsInputSchema`. Remove import of `listViewsTool` from list.ts. Remove import from functions.ts.

**Step 7: Run tests to verify they pass**

Run: `npm run test:unit -- --testPathPattern list-objects`
Expected: PASS

**Step 8: Delete old test files and update integration tests**

Delete `tests/unit/tools/functions.test.ts`. Update `tests/unit/tools/list.test.ts` to test `listObjectsTool` (or delete and rely on `list-objects.test.ts`).

In `tests/integration/container.test.ts`:
- Update `createTestTools` (line 41-52): replace `listTablesTool, listViewsTool` import with `listObjectsTool`. Remove `listFunctionsTool` import.
- Update test cases: replace `listTablesTool({ schema: 'testschema' })` with `listObjectsTool({ type: 'tables', schema: 'testschema' })`. Same for views and functions.

**Step 9: Run all tests**

Run: `npm test`
Expected: All tests pass.

**Step 10: Commit**

```bash
git add src/validation.ts src/tools/list.ts src/index.ts tests/
git rm src/tools/functions.ts tests/unit/tools/functions.test.ts
git commit -m "$(cat <<'EOF'
refactor: consolidate list_tables, list_views, list_functions into list_objects

BREAKING: Replaces three separate tools with a single list_objects tool
that accepts a type parameter ('tables', 'views', 'functions').
EOF
)"
```

---

### Task 2: Consolidate describe_table + get_constraints + get_table_stats → describe_table

**Files:**
- Modify: `src/validation.ts` (remove GetTableStatsInputSchema)
- Modify: `src/tools/describe.ts` (merge all three queries into one function)
- Modify: `src/tools/performance.ts` (remove getTableStatsTool, keep explainQueryTool)
- Modify: `src/index.ts` (remove get_constraints and get_table_stats registrations)
- Modify: `tests/unit/tools/describe.test.ts` (test merged output)
- Modify: `tests/unit/tools/performance.test.ts` (remove stats tests)
- Modify: `tests/integration/container.test.ts` (update tool calls)

**Step 1: Write the failing test**

Update `tests/unit/tools/describe.test.ts` to expect the merged response:

```typescript
test('should return columns, constraints, and stats', async () => {
  const { describeTableTool } = await import('../../../src/tools/describe');
  const result = await describeTableTool({
    schema: 'public',
    table: 'users'
  });
  expect(result.columns).toBeDefined();
  expect(result.constraints).toBeDefined();
  expect(result.stats).toBeDefined();
  expect(result.error).toBeUndefined();
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern describe`
Expected: FAIL — `result.constraints` and `result.stats` are undefined.

**Step 3: Update `src/tools/describe.ts`**

The new `describeTableTool` runs 3 queries in parallel and merges results:

```typescript
export interface DescribeTableOutput {
  columns?: ColumnInfo[];
  constraints?: ConstraintInfo[];
  stats?: TableStatsInfo;
  error?: string;
}

export async function describeTableTool(input: DescribeTableInput): Promise<DescribeTableOutput> {
  try {
    const db = getDb();
    const [columnsResult, constraintsResult, statsResult] = await Promise.all([
      sql<ColumnInfo>`...columns query...`.execute(db),
      sql<ConstraintInfo>`...constraints query...`.execute(db),
      sql<TableStatsInfo>`...stats query from performance.ts...`.execute(db),
    ]);
    return {
      columns: columnsResult.rows,
      constraints: constraintsResult.rows,
      stats: statsResult.rows[0] || null,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}
```

Move the `TableStatsInfo` interface from `performance.ts` to `describe.ts`. The stats query is the single-table variant from `performance.ts:108-126`.

Remove `getConstraintsTool` as a separate export.

**Step 4: Update `src/tools/performance.ts`**

Remove `getTableStatsTool`, `GetTableStatsOutput`, `TableStatsInfo` exports. Keep only `explainQueryTool`.

**Step 5: Update `src/validation.ts`**

Remove `GetTableStatsInputSchema` (lines 62-68) and its type alias (line 108).

**Step 6: Update `src/index.ts`**

Remove tool registrations for `get_constraints` and `get_table_stats`. Remove their `case` blocks. Remove import of `getConstraintsTool` from describe.ts. Remove import of `getTableStatsTool` from performance.ts. Remove import of `GetTableStatsInputSchema`.

**Step 7: Update tests**

In `tests/unit/tools/describe.test.ts`:
- Remove the entire `Get Constraints Tool Unit Tests` describe block (lines 125-217). Constraint testing now happens inside the describe_table tests.
- Update mock to return all 3 query results.

In `tests/unit/tools/performance.test.ts`:
- Remove tests for `getTableStatsTool`.

In `tests/integration/container.test.ts`:
- Remove separate `getConstraintsTool` and `getTableStatsTool` calls.
- Update `describeTableTool` test to assert `result.constraints` and `result.stats`.
- Update `createTestTools` imports.

**Step 8: Run all tests**

Run: `npm test`
Expected: All pass.

**Step 9: Commit**

```bash
git add src/validation.ts src/tools/describe.ts src/tools/performance.ts src/index.ts tests/
git commit -m "$(cat <<'EOF'
refactor: merge get_constraints and get_table_stats into describe_table

BREAKING: describe_table now returns columns, constraints, and stats in a
single call. Removes get_constraints and get_table_stats as separate tools.
EOF
)"
```

---

### Task 3: Trim token footprint on remaining tools

**Files:**
- Modify: `src/validation.ts:3-13` (remove .describe() strings)
- Modify: `src/index.ts:53-55` (shorten query description)

**Step 1: Remove `.describe()` from QueryInputSchema**

In `src/validation.ts`, lines 10-12:
```typescript
// Before:
  ])).optional().describe("Optional array of parameters for parameterized queries"),
  pageSize: z.number().min(1).max(500).optional().describe("Number of rows to return (1-500, default: 100)"),
  offset: z.number().min(0).optional().describe("Number of rows to skip for pagination")

// After:
  ])).optional(),
  pageSize: z.number().min(1).max(500).optional(),
  offset: z.number().min(0).optional()
```

**Step 2: Shorten query tool description**

In `src/index.ts`, line 54:
```typescript
// Before:
description: "Execute SQL queries with pagination support and parameterization for security. Supports page sizes up to 500 rows.",

// After:
description: "Execute SQL with pagination and parameterization",
```

**Step 3: Run tests**

Run: `npm test`
Expected: All pass (no behavioral change).

**Step 4: Commit**

```bash
git add src/validation.ts src/index.ts
git commit -m "$(cat <<'EOF'
refactor: trim tool description tokens

Remove redundant .describe() strings from QueryInputSchema and shorten
tool descriptions. Reduces MCP tool definition token footprint.
EOF
)"
```

---

### Task 4: Add search_objects tool

**Files:**
- Create: `src/tools/search.ts`
- Modify: `src/validation.ts` (add SearchObjectsInputSchema)
- Modify: `src/index.ts` (register tool)
- Create: `tests/unit/tools/search.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/tools/search.test.ts`:

```typescript
import { describe, test, expect, afterEach } from '@jest/globals';
import { cleanupDatabase } from '../../helpers/cleanup';

jest.mock('kysely', () => ({
  sql: jest.fn(() => ({
    execute: jest.fn(() => Promise.resolve({
      rows: [
        { object_type: 'table', schema_name: 'public', object_name: 'users', table_name: null, details: 'BASE TABLE' },
        { object_type: 'column', schema_name: 'public', object_name: 'user_id', table_name: 'posts', details: 'integer' },
      ]
    }))
  })),
  Kysely: jest.fn(),
  PostgresDialect: jest.fn()
}));

jest.mock('../../../src/db', () => ({
  getDb: jest.fn(() => ({})),
  closeDb: jest.fn(() => Promise.resolve())
}));

describe('search_objects tool', () => {
  afterEach(async () => {
    await cleanupDatabase();
    jest.clearAllMocks();
  });

  test('should search for objects by pattern', async () => {
    const { searchObjectsTool } = await import('../../../src/tools/search');
    const result = await searchObjectsTool({ pattern: 'user' });
    expect(result.results).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(Array.isArray(result.results)).toBe(true);
  });

  test('should require pattern parameter', async () => {
    const { searchObjectsTool } = await import('../../../src/tools/search');
    const result = await searchObjectsTool({} as any);
    expect(result.error).toBeDefined();
  });

  test('should filter by object_types', async () => {
    const { searchObjectsTool } = await import('../../../src/tools/search');
    const result = await searchObjectsTool({ pattern: 'user', object_types: ['table'] });
    expect(result.results).toBeDefined();
  });

  test('should respect limit parameter', async () => {
    const { searchObjectsTool } = await import('../../../src/tools/search');
    const result = await searchObjectsTool({ pattern: 'user', limit: 5 });
    expect(result.results).toBeDefined();
  });

  test('should handle errors gracefully', async () => {
    const { sql } = await import('kysely');
    (sql as jest.MockedFunction<typeof sql>).mockImplementationOnce(() => ({
      execute: jest.fn(() => Promise.reject(new Error('DB error')))
    } as any));

    const { searchObjectsTool } = await import('../../../src/tools/search');
    const result = await searchObjectsTool({ pattern: 'user' });
    expect(result.error).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern search`
Expected: FAIL — module not found.

**Step 3: Add validation schema**

In `src/validation.ts`, add:

```typescript
export const SearchObjectsInputSchema = z.object({
  pattern: z.string().min(1).max(200),
  object_types: z.array(z.enum(['table', 'view', 'column', 'function', 'index', 'constraint'])).optional(),
  schemas: z.array(z.string().min(1).max(63)).optional(),
  limit: z.number().min(1).max(100).optional()
});

export type SearchObjectsInput = z.infer<typeof SearchObjectsInputSchema>;
```

**Step 4: Implement `src/tools/search.ts`**

```typescript
import { getDb } from "../db.js";
import { sql } from "kysely";
import { SearchObjectsInputSchema, validateInput } from "../validation.js";

export interface SearchResult {
  object_type: string;
  schema_name: string;
  table_name?: string;
  object_name: string;
  details: string;
}

export interface SearchObjectsOutput {
  results?: SearchResult[];
  total_matches?: number;
  truncated?: boolean;
  error?: string;
}

export async function searchObjectsTool(input: unknown): Promise<SearchObjectsOutput> {
  try {
    const validation = validateInput(SearchObjectsInputSchema, input);
    if (!validation.success) {
      return { error: `Input validation failed: ${validation.error}` };
    }

    const { pattern, object_types, schemas, limit: maxResults } = validation.data;
    const db = getDb();
    const likePattern = `%${pattern}%`;
    const resultLimit = maxResults || 20;

    // Build UNION ALL query across object types
    // Each subquery searches a specific object type
    // Filter by requested object_types (default: all)
    const typesToSearch = object_types || ['table', 'view', 'column', 'function', 'index', 'constraint'];

    const subqueries: string[] = [];

    if (typesToSearch.includes('table')) {
      subqueries.push(`
        SELECT 'table' as object_type, table_schema as schema_name, NULL as table_name,
               table_name as object_name, table_type as details
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND LOWER(table_name) LIKE LOWER('${likePattern}')
      `);
    }

    // ... similar for view, column, function, index, constraint
    // (Full implementation uses parameterized queries via Kysely sql tag,
    //  NOT string interpolation. The above is pseudocode for the plan.)

    // Execute the UNION ALL with LIMIT
    // Return { results, total_matches, truncated }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}
```

**IMPORTANT:** The actual implementation MUST use Kysely's `sql` template tag with `${likePattern}` for parameterization, NOT string interpolation. The pseudocode above shows the SQL structure. The real code parameterizes `likePattern` and builds the UNION using `sql.raw()` with proper escaping, or runs separate queries per type and merges in JS.

The safest approach: run one parameterized query per object type, merge results in JS, sort by relevance, apply limit. This avoids SQL injection risk from dynamic UNION construction.

**Step 5: Register in `src/index.ts`**

Add import, tool definition, and case block.

```typescript
{
  name: "search_objects",
  description: "Find tables, columns, functions, views by name pattern across schemas",
  inputSchema: getInlineSchema(SearchObjectsInputSchema, "SearchObjectsInput"),
}
```

**Step 6: Run tests**

Run: `npm run test:unit -- --testPathPattern search`
Expected: PASS

**Step 7: Commit**

```bash
git add src/tools/search.ts src/validation.ts src/index.ts tests/unit/tools/search.test.ts
git commit -m "feat: add search_objects tool for cross-schema object discovery"
```

---

### Task 5: Add get_connections tool

**Files:**
- Create: `src/tools/connections.ts`
- Modify: `src/validation.ts` (add GetConnectionsInputSchema)
- Modify: `src/index.ts` (register tool)
- Create: `tests/unit/tools/connections.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/tools/connections.test.ts`:

```typescript
import { describe, test, expect, afterEach } from '@jest/globals';
import { cleanupDatabase } from '../../helpers/cleanup';

jest.mock('kysely', () => {
  const mockExecute = jest.fn();
  return {
    sql: jest.fn(() => ({ execute: mockExecute })),
    Kysely: jest.fn(),
    PostgresDialect: jest.fn(),
    __mockExecute: mockExecute,
  };
});

jest.mock('../../../src/db', () => ({
  getDb: jest.fn(() => ({})),
  closeDb: jest.fn(() => Promise.resolve())
}));

describe('get_connections tool', () => {
  let mockExecute: jest.Mock;

  beforeEach(() => {
    const kysely = require('kysely');
    mockExecute = kysely.__mockExecute;

    // Default: return summary then connections
    mockExecute
      .mockResolvedValueOnce({
        rows: [{ max_connections: '100' }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            pid: 123, usename: 'postgres', datname: 'mydb',
            application_name: 'psql', client_addr: '127.0.0.1',
            state: 'active', state_change: '2026-03-08T00:00:00Z',
            duration_seconds: 5, wait_event_type: null, wait_event: null,
            query: 'SELECT 1'
          }
        ]
      });
  });

  afterEach(async () => {
    await cleanupDatabase();
    jest.clearAllMocks();
  });

  test('should return connection summary and details', async () => {
    const { getConnectionsTool } = await import('../../../src/tools/connections');
    const result = await getConnectionsTool({});
    expect(result.summary).toBeDefined();
    expect(result.summary!.total).toBeDefined();
    expect(result.summary!.max_connections).toBeDefined();
    expect(result.connections).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  test('should generate warnings for idle-in-transaction', async () => {
    mockExecute
      .mockReset()
      .mockResolvedValueOnce({ rows: [{ max_connections: '100' }] })
      .mockResolvedValueOnce({
        rows: [{
          pid: 456, usename: 'app', datname: 'mydb',
          application_name: 'web', client_addr: '10.0.0.1',
          state: 'idle in transaction', state_change: '2026-03-07T23:50:00Z',
          duration_seconds: 600, wait_event_type: null, wait_event: null,
          query: 'BEGIN'
        }]
      });

    const { getConnectionsTool } = await import('../../../src/tools/connections');
    const result = await getConnectionsTool({});
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.length).toBeGreaterThan(0);
  });

  test('should handle errors gracefully', async () => {
    mockExecute.mockReset().mockRejectedValueOnce(new Error('Connection refused'));

    const { getConnectionsTool } = await import('../../../src/tools/connections');
    const result = await getConnectionsTool({});
    expect(result.error).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern connections`
Expected: FAIL

**Step 3: Add validation schema**

In `src/validation.ts`:

```typescript
export const GetConnectionsInputSchema = z.object({
  include_queries: z.boolean().optional(),
  group_by: z.enum(['state', 'user', 'application', 'client']).optional()
});

export type GetConnectionsInput = z.infer<typeof GetConnectionsInputSchema>;
```

**Step 4: Implement `src/tools/connections.ts`**

Two queries:
1. `SHOW max_connections` (or `SELECT setting FROM pg_settings WHERE name = 'max_connections'`)
2. `SELECT pid, usename, datname, application_name, client_addr, state, backend_start, state_change, EXTRACT(EPOCH FROM (now() - state_change)) as duration_seconds, wait_event_type, wait_event, query FROM pg_stat_activity WHERE datname IS NOT NULL`

Compute summary by aggregating states. Generate warnings for:
- idle-in-transaction > 300s
- utilization > 70%
- any connections in `waiting` state

Omit `query` field from results unless `include_queries` is true.

**Step 5: Register in `src/index.ts`**

```typescript
{
  name: "get_connections",
  description: "Show active database connections, utilization, and idle-in-transaction warnings",
  inputSchema: getInlineSchema(GetConnectionsInputSchema, "GetConnectionsInput"),
}
```

**Step 6: Run tests**

Run: `npm run test:unit -- --testPathPattern connections`
Expected: PASS

**Step 7: Commit**

```bash
git add src/tools/connections.ts src/validation.ts src/index.ts tests/unit/tools/connections.test.ts
git commit -m "feat: add get_connections tool for connection monitoring and lock detection"
```

---

### Task 6: Add diagnose_database tool

**Files:**
- Create: `src/tools/diagnostics.ts`
- Modify: `src/validation.ts` (add DiagnoseDatabaseInputSchema)
- Modify: `src/index.ts` (register tool)
- Create: `tests/unit/tools/diagnostics.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/tools/diagnostics.test.ts`. Key test cases:

```typescript
test('should return healthy status for good metrics', async () => {
  // Mock all queries to return healthy values
  const { diagnoseDatabaseTool } = await import('../../../src/tools/diagnostics');
  const result = await diagnoseDatabaseTool({});
  expect(result.status).toBe('healthy');
  expect(result.summary).toBeDefined();
  expect(result.checks).toBeDefined();
  expect(result.checks_skipped).toBeDefined();
});

test('should return warning for low cache hit ratio', async () => {
  // Mock cache hit ratio at 97%
  // ...
  expect(result.status).toBe('warning');
  expect(result.checks.cache_hit_ratio.status).toBe('warning');
});

test('should return critical for very low cache hit ratio', async () => {
  // Mock cache hit ratio at 90%
  expect(result.status).toBe('critical');
});

test('should skip pg_stat_statements check when extension missing', async () => {
  // Mock extension check to return 0 rows
  expect(result.checks_skipped).toContain(expect.stringContaining('pg_stat_statements'));
});

test('should detect unused indexes', async () => {
  // Mock pg_stat_user_indexes with idx_scan = 0
  expect(result.checks.unused_indexes.status).toBe('warning');
});

test('should detect idle-in-transaction connections', async () => {
  // Mock pg_stat_activity with idle in transaction > 300s
  expect(result.checks.connections.status).toBe('warning');
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern diagnostics`
Expected: FAIL

**Step 3: Add validation schema**

In `src/validation.ts`:

```typescript
export const DiagnoseDatabaseInputSchema = z.object({
  include_queries: z.boolean().optional(),
  include_connections: z.boolean().optional()
});

export type DiagnoseDatabaseInput = z.infer<typeof DiagnoseDatabaseInputSchema>;
```

**Step 4: Implement `src/tools/diagnostics.ts`**

This is the most complex tool. Structure:

```typescript
export async function diagnoseDatabaseTool(input: unknown): Promise<DiagnoseDatabaseOutput> {
  // 1. Validate input
  // 2. Run checks in parallel where possible:

  const checks: Record<string, CheckResult> = {};
  const checksSkipped: string[] = [];

  // Cache hit ratio
  // SELECT sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0) * 100
  // FROM pg_stat_database WHERE datname = current_database()

  // Connection saturation (reuse get_connections logic or query directly)
  // SELECT count(*) FILTER (WHERE state = 'active') as active,
  //        count(*) FILTER (WHERE state = 'idle') as idle,
  //        count(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction,
  //        count(*) as total
  // FROM pg_stat_activity WHERE datname IS NOT NULL

  // Long-running queries
  // SELECT pid, EXTRACT(EPOCH FROM (now() - query_start)) as duration_seconds,
  //        state, LEFT(query, 200) as query_preview
  // FROM pg_stat_activity WHERE state = 'active' AND query_start < now() - interval '30 seconds'

  // Blocking locks
  // SELECT blocked.pid as blocked_pid, blocking.pid as blocking_pid,
  //        LEFT(blocked_activity.query, 200), LEFT(blocking_activity.query, 200)
  // FROM pg_locks blocked JOIN pg_locks blocking ON ...

  // Vacuum health
  // SELECT schemaname, relname, n_dead_tup, n_live_tup, last_vacuum, last_autovacuum
  // FROM pg_stat_user_tables WHERE n_dead_tup > 10000

  // Unused indexes
  // SELECT schemaname, relname as table_name, indexrelname as index_name,
  //        pg_size_pretty(pg_relation_size(indexrelid))
  // FROM pg_stat_user_indexes WHERE idx_scan = 0 AND indexrelname NOT LIKE '%pkey%'

  // Duplicate indexes (indexes with same column set on same table)
  // Group by table + array_agg(column) from pg_index

  // Sequence health
  // SELECT schemaname, sequencename, last_value, max_value,
  //        (last_value::float / max_value * 100) as pct_used
  // FROM pg_sequences WHERE last_value::float / max_value > 0.75

  // Database size
  // SELECT pg_database_size(current_database()), pg_size_pretty(pg_database_size(current_database()))

  // 3. Determine overall status (worst of all check statuses)
  // 4. Generate summary string
  // 5. Return
}
```

Thresholds (defined as constants at top of file):
- `CACHE_HIT_WARNING = 99`, `CACHE_HIT_CRITICAL = 95`
- `CONNECTION_WARNING_PCT = 70`, `CONNECTION_CRITICAL_PCT = 90`
- `LONG_QUERY_WARNING_SECS = 60`, `LONG_QUERY_CRITICAL_SECS = 300`
- `DEAD_TUPLE_WARNING = 10000`, `DEAD_TUPLE_PCT_WARNING = 10`
- `SEQUENCE_WARNING_PCT = 75`, `SEQUENCE_CRITICAL_PCT = 90`

**Step 5: Register in `src/index.ts`**

```typescript
{
  name: "diagnose_database",
  description: "Composite database health check: cache, connections, vacuum, indexes, sequences",
  inputSchema: getInlineSchema(DiagnoseDatabaseInputSchema, "DiagnoseDatabaseInput"),
}
```

**Step 6: Run tests**

Run: `npm run test:unit -- --testPathPattern diagnostics`
Expected: PASS

**Step 7: Commit**

```bash
git add src/tools/diagnostics.ts src/validation.ts src/index.ts tests/unit/tools/diagnostics.test.ts
git commit -m "feat: add diagnose_database tool for composite health assessment"
```

---

### Task 7: Add get_slow_queries tool

**Files:**
- Create: `src/tools/slow-queries.ts`
- Modify: `src/validation.ts` (add GetSlowQueriesInputSchema)
- Modify: `src/index.ts` (register tool)
- Create: `tests/unit/tools/slow-queries.test.ts`

**Step 1: Write the failing test**

Key test cases:

```typescript
test('should return slow queries when pg_stat_statements available', async () => {
  // Mock extension check → found
  // Mock pg_stat_statements query → rows
  const result = await getSlowQueriesTool({});
  expect(result.extension_installed).toBe(true);
  expect(result.queries).toBeDefined();
  expect(result.queries!.length).toBeGreaterThan(0);
});

test('should return graceful response when extension not installed', async () => {
  // Mock extension check → not found (0 rows)
  const result = await getSlowQueriesTool({});
  expect(result.extension_installed).toBe(false);
  expect(result.hint).toBeDefined();
  expect(result.queries).toBeUndefined();
});

test('should sort by total_time by default', async () => {
  // Mock with multiple queries, verify order
});

test('should filter by min_calls', async () => {
  const result = await getSlowQueriesTool({ min_calls: 10 });
  // Verify SQL includes HAVING calls >= 10
});

test('should omit query text when include_query_text is false', async () => {
  const result = await getSlowQueriesTool({ include_query_text: false });
  // Verify query field is null/undefined in results
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern slow-queries`
Expected: FAIL

**Step 3: Add validation schema**

```typescript
export const GetSlowQueriesInputSchema = z.object({
  sort_by: z.enum(['total_time', 'mean_time', 'calls', 'rows']).optional(),
  limit: z.number().min(1).max(50).optional(),
  min_calls: z.number().min(0).optional(),
  min_duration_ms: z.number().min(0).optional(),
  include_query_text: z.boolean().optional()
});

export type GetSlowQueriesInput = z.infer<typeof GetSlowQueriesInputSchema>;
```

**Step 4: Implement `src/tools/slow-queries.ts`**

```typescript
export async function getSlowQueriesTool(input: unknown): Promise<GetSlowQueriesOutput> {
  // 1. Validate input
  // 2. Check extension: SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
  // 3. If not installed, return { extension_installed: false, hint: "..." }
  // 4. Query pg_stat_statements:

  // SELECT query, calls, total_exec_time as total_time_ms,
  //        mean_exec_time as mean_time_ms, min_exec_time as min_time_ms,
  //        max_exec_time as max_time_ms, stddev_exec_time as stddev_time_ms,
  //        rows, shared_blks_hit, shared_blks_read,
  //        CASE WHEN shared_blks_hit + shared_blks_read > 0
  //          THEN shared_blks_hit::float / (shared_blks_hit + shared_blks_read) * 100
  //          ELSE 100 END as cache_hit_ratio,
  //        temp_blks_written
  // FROM pg_stat_statements
  // WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
  //   AND calls >= $min_calls
  //   AND mean_exec_time >= $min_duration_ms
  // ORDER BY $sort_by DESC
  // LIMIT $limit

  // NOTE: pg_stat_statements column names changed in PG13.
  // total_time → total_exec_time, mean_time → mean_exec_time, etc.
  // Use try/catch with fallback column names, or detect PG version.
  // Simplest: try new names first, if error contains "column ... does not exist", retry with old names.

  // 5. Get stats_reset timestamp
  // SELECT stats_reset FROM pg_stat_statements_info (PG14+) or skip
}
```

**Step 5: Register in `src/index.ts`**

```typescript
{
  name: "get_slow_queries",
  description: "Analyze slow queries via pg_stat_statements with filtering and sorting",
  inputSchema: getInlineSchema(GetSlowQueriesInputSchema, "GetSlowQueriesInput"),
}
```

**Step 6: Run tests**

Run: `npm run test:unit -- --testPathPattern slow-queries`
Expected: PASS

**Step 7: Commit**

```bash
git add src/tools/slow-queries.ts src/validation.ts src/index.ts tests/unit/tools/slow-queries.test.ts
git commit -m "feat: add get_slow_queries tool with pg_stat_statements integration"
```

---

### Task 8: Integration tests for new tools

**Files:**
- Modify: `tests/setup/testcontainer.ts:43-47` (enable pg_stat_statements)
- Modify: `tests/fixtures/test-schema.sql` (add sequence, more fixtures)
- Modify: `tests/integration/container.test.ts` (add test cases)

**Step 1: Update testcontainer to enable pg_stat_statements**

In `tests/setup/testcontainer.ts`, modify the container creation (line 43):

```typescript
container = await new PostgreSqlContainer('postgres:15')
  .withDatabase('testdb')
  .withUsername('testuser')
  .withPassword('testpass')
  .withCommand([
    'postgres',
    '-c', 'shared_preload_libraries=pg_stat_statements',
    '-c', 'pg_stat_statements.track=all'
  ])
  .start();
```

After container starts and schema loads, create the extension:

```typescript
await sql.raw('CREATE EXTENSION IF NOT EXISTS pg_stat_statements').execute(db);
```

**Step 2: Add test fixtures**

Append to `tests/fixtures/test-schema.sql`:

```sql
-- Sequence for testing diagnose_database sequence health check
CREATE SEQUENCE testschema.test_sequence START 1 MAXVALUE 100;
SELECT setval('testschema.test_sequence', 80);
```

**Step 3: Write integration tests for new tools**

Add to `tests/integration/container.test.ts`:

```typescript
test('should search objects across schemas', async () => {
  if (!dockerAvailable || !containerSetup) return;
  const testTools = createTestTools(containerSetup.connectionInfo);
  try {
    const { searchObjectsTool, closeDb } = await testTools.getTools();
    const result = await searchObjectsTool({ pattern: 'user' });
    expect(result.error).toBeUndefined();
    expect(result.results).toBeDefined();
    expect(result.results!.length).toBeGreaterThan(0);
    const types = result.results!.map(r => r.object_type);
    expect(types).toContain('table');
    expect(types).toContain('column');
    await closeDb();
  } finally { testTools.cleanup(); }
});

test('should diagnose database health', async () => {
  if (!dockerAvailable || !containerSetup) return;
  const testTools = createTestTools(containerSetup.connectionInfo);
  try {
    const { diagnoseDatabaseTool, closeDb } = await testTools.getTools();
    const result = await diagnoseDatabaseTool({});
    expect(result.error).toBeUndefined();
    expect(result.status).toBeDefined();
    expect(['healthy', 'warning', 'critical']).toContain(result.status);
    expect(result.checks).toBeDefined();
    expect(result.checks.cache_hit_ratio).toBeDefined();
    expect(result.checks.connections).toBeDefined();
    expect(result.checks.database_size).toBeDefined();
    await closeDb();
  } finally { testTools.cleanup(); }
});

test('should get slow queries from pg_stat_statements', async () => {
  if (!dockerAvailable || !containerSetup) return;
  const testTools = createTestTools(containerSetup.connectionInfo);
  try {
    const { getSlowQueriesTool, queryTool, closeDb } = await testTools.getTools();
    // Run some queries first to populate pg_stat_statements
    await queryTool({ sql: 'SELECT * FROM testschema.users' });
    await queryTool({ sql: 'SELECT * FROM testschema.posts' });
    const result = await getSlowQueriesTool({});
    expect(result.extension_installed).toBe(true);
    expect(result.queries).toBeDefined();
    await closeDb();
  } finally { testTools.cleanup(); }
});

test('should get active connections', async () => {
  if (!dockerAvailable || !containerSetup) return;
  const testTools = createTestTools(containerSetup.connectionInfo);
  try {
    const { getConnectionsTool, closeDb } = await testTools.getTools();
    const result = await getConnectionsTool({ include_queries: true });
    expect(result.error).toBeUndefined();
    expect(result.summary).toBeDefined();
    expect(result.summary!.total).toBeGreaterThan(0);
    expect(result.connections).toBeDefined();
    await closeDb();
  } finally { testTools.cleanup(); }
});

test('should detect sequence near limit', async () => {
  if (!dockerAvailable || !containerSetup) return;
  const testTools = createTestTools(containerSetup.connectionInfo);
  try {
    const { diagnoseDatabaseTool, closeDb } = await testTools.getTools();
    const result = await diagnoseDatabaseTool({});
    expect(result.checks.sequence_health).toBeDefined();
    if (result.checks.sequence_health.sequences_near_limit) {
      const testSeq = result.checks.sequence_health.sequences_near_limit.find(
        (s: any) => s.name === 'test_sequence'
      );
      expect(testSeq).toBeDefined();
      expect(testSeq!.pct_used).toBeGreaterThan(75);
    }
    await closeDb();
  } finally { testTools.cleanup(); }
});
```

**Step 4: Update createTestTools to import new tools**

Add imports for `searchObjectsTool`, `diagnoseDatabaseTool`, `getSlowQueriesTool`, `getConnectionsTool` and add the module cache clearing for the new files.

**Step 5: Run integration tests**

Run: `npm run test:integration`
Expected: All pass (requires Docker).

**Step 6: Commit**

```bash
git add tests/
git commit -m "test: add integration tests for diagnostic tools with pg_stat_statements"
```

---

### Task 9: Plugin scaffolding

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.mcp.json`
- Create: `skills/database-health/SKILL.md`
- Create: `skills/slow-query-analysis/SKILL.md`
- Create: `skills/connection-debug/SKILL.md`

**Step 1: Create plugin manifest**

Create `.claude-plugin/plugin.json`:

```json
{
  "name": "postgres-mcp-server",
  "version": "2.0.0",
  "description": "PostgreSQL database access with health diagnostics, slow query analysis, and connection monitoring",
  "components": {
    "skills": ["skills/*/SKILL.md"],
    "mcp": [".mcp.json"]
  }
}
```

**Step 2: Create MCP configuration**

Create `.mcp.json`:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["postgres-mcp-server@latest"],
      "env": {
        "DB_HOST": "${DB_HOST:-127.0.0.1}",
        "DB_PORT": "${DB_PORT:-5432}",
        "DB_USER": "${DB_USER:-postgres}",
        "DB_NAME": "${DB_NAME:-postgres}",
        "DB_PASSWORD": "${DB_PASSWORD}",
        "DB_SSL": "${DB_SSL:-true}",
        "READ_ONLY": "${READ_ONLY:-true}"
      }
    }
  }
}
```

**Step 3: Create skills**

Create `skills/database-health/SKILL.md`:

```markdown
---
name: database-health
description: Diagnose database health issues including cache performance, connection saturation, vacuum status, and unused indexes. Use when investigating database problems or running routine health checks.
---

Run the diagnose_database MCP tool to get a composite health assessment.

Interpret results by status:
- critical: Address critical checks immediately. Common actions: kill idle-in-transaction connections, run VACUUM on bloated tables, increase shared_buffers for low cache hit ratio.
- warning: Schedule maintenance. Review unused indexes for removal, check vacuum schedules, monitor connection trends.
- healthy: Confirm health. Note any checks_skipped that may need extension installation.

If slow queries appear in results, offer to run get_slow_queries for deeper analysis.
If connection issues appear, offer to run get_connections for per-connection detail.
If pg_stat_statements is not installed, suggest enabling it for slow query visibility.
```

Create `skills/slow-query-analysis/SKILL.md`:

```markdown
---
name: slow-query-analysis
description: Analyze slow queries and suggest optimizations including missing indexes and query rewrites. Use when investigating query performance, high CPU usage, or slow response times.
---

Workflow:
1. Run get_slow_queries sorted by total_time to find biggest time consumers
2. For the top offender, run explain_query with analyze=true to see the actual execution plan
3. Look for: sequential scans on large tables (suggest index), nested loops with high row counts (suggest join rewrite), sorts spilling to disk (suggest work_mem increase or index)
4. Check list_indexes on affected tables to see what indexes exist
5. Suggest specific actions: CREATE INDEX statements, query rewrites, or configuration changes

If pg_stat_statements is not installed, guide setup:
- Add shared_preload_libraries = 'pg_stat_statements' to postgresql.conf
- Restart PostgreSQL
- Run CREATE EXTENSION pg_stat_statements
- For RDS/Aurora: modify parameter group, reboot instance
```

Create `skills/connection-debug/SKILL.md`:

```markdown
---
name: connection-debug
description: Debug database connection issues including too many connections, idle transactions, lock contention, and connection pool exhaustion. Use when the database is unresponsive, connections are refused, or queries are stuck waiting.
---

Workflow:
1. Run get_connections with include_queries=true to see all active connections
2. Check warnings for idle-in-transaction connections. If any are > 10 minutes, suggest terminating with SELECT pg_terminate_backend(pid)
3. If utilization > 80%, identify top consumers by application_name or user
4. If any connections show wait_event_type = 'Lock', run diagnose_database to see blocking lock chains
5. Suggest remediation: increase max_connections, configure connection pooling (PgBouncer), set idle_in_transaction_session_timeout, fix application connection leaks
```

**Step 4: Commit**

```bash
git add .claude-plugin/ .mcp.json skills/
git commit -m "feat: add Claude Code plugin manifest with diagnostic skills"
```

---

### Task 10: Version bump, README, and final verification

**Files:**
- Modify: `package.json:2` (version → 2.0.0)
- Modify: `src/index.ts:38` (version → 2.0.0)
- Modify: `README.md` (update tool list, add plugin installation, add diagnostics section)
- Modify: `CLAUDE.md` (update tool count and names)

**Step 1: Bump version**

In `package.json` line 3: `"version": "2.0.0"`
In `src/index.ts` line 39: `version: "2.0.0"`

**Step 2: Update README.md**

Add sections for:
- Plugin installation: `claude plugin install postgres-mcp-server`
- New tool descriptions: search_objects, diagnose_database, get_slow_queries, get_connections
- Breaking changes from v1.x: tool consolidation table
- pg_stat_statements setup guide for RDS, Aurora, vanilla PG

**Step 3: Update CLAUDE.md**

Update the tool list and tool count. Update architecture section to reflect consolidated tools.

**Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass.

Run: `npm run build`
Expected: Clean compilation, no errors.

**Step 5: Commit**

```bash
git add package.json src/index.ts README.md CLAUDE.md
git commit -m "$(cat <<'EOF'
feat: release v2.0.0 — diagnostic tools and plugin conversion

BREAKING CHANGES:
- list_tables, list_views, list_functions replaced by list_objects
- get_constraints, get_table_stats absorbed into describe_table
- Version bump to 2.0.0

New features:
- search_objects: cross-schema object discovery by pattern
- diagnose_database: composite health check (cache, connections, vacuum, indexes, sequences)
- get_slow_queries: pg_stat_statements integration with filtering
- get_connections: connection monitoring with idle-in-transaction detection
- Claude Code plugin with diagnostic skills
EOF
)"
```

---

## Task Dependency Graph

```
Task 1 (list_objects) ──┐
Task 2 (describe_table) ├─→ Task 3 (trim tokens) ─→ Task 4 (search_objects) ─┐
                        │                           Task 5 (get_connections) ──├─→ Task 8 (integration tests) ─→ Task 9 (plugin) ─→ Task 10 (release)
                        │                           Task 6 (diagnose_database)─┤
                        │                           Task 7 (get_slow_queries) ─┘
                        │
Tasks 1-2 can run in parallel.
Tasks 4-7 can run in parallel (after Task 3).
```

## Review Checkpoints

- **After Task 2:** Verify consolidated tools work end-to-end. Run `npm test`. This is the riskiest refactor — existing functionality must not regress.
- **After Task 7:** All 10 tools implemented. Run full test suite. Manual smoke test with a real database if available.
- **After Task 9:** Plugin structure complete. Verify with `ls -la .claude-plugin/ skills/`.
- **After Task 10:** Final release candidate. Build, test, verify README accuracy.
