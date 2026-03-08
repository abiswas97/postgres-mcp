# Test Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fill critical test gaps in MCP protocol layer and db.ts connection handling so nothing breaks for users.

**Architecture:** Four test components: (1) MCP handler unit tests using InMemoryTransport with mocked tools, (2) E2E MCP client test against real testcontainer DB, (3) enhanced db.ts unit tests for config/SSL edge cases, (4) real connection tests piggyback on existing container suite.

**Tech Stack:** Jest (ts-jest ESM preset), @modelcontextprotocol/sdk 0.6.1 (Client, Server, InMemoryTransport), @testcontainers/postgresql, Kysely, Zod

---

### Task 1: Enhanced db.ts Unit Tests

Tests config parsing, SSL building, getConfig/isConnected, and missing DB_PASSWORD error.

**Files:**
- Modify: `tests/unit/db.test.ts`

**Step 1: Write new tests**

Add these test blocks to the existing `tests/unit/db.test.ts` file, inside the top-level `describe('Database Module', ...)`:

```typescript
describe('Config Validation', () => {
  test('should throw when DB_PASSWORD is missing', () => {
    delete process.env.DB_PASSWORD;
    delete require.cache[require.resolve('../../src/db')];

    const { getDbManager } = require('../../src/db');
    expect(() => getDbManager()).toThrow('DB_PASSWORD environment variable is required');
  });

  test('should parse numeric env vars correctly', async () => {
    process.env.DB_PASSWORD = 'test';
    process.env.DB_PORT = '5433';
    process.env.DB_POOL_MAX = '10';
    process.env.DB_IDLE_TIMEOUT = '3000';
    process.env.DB_CONNECTION_TIMEOUT = '5000';
    process.env.DB_QUERY_TIMEOUT = '15000';

    const { getDbManager } = await import('../../src/db');
    const config = getDbManager().getConfig();

    expect(config.port).toBe(5433);
    expect(config.maxConnections).toBe(10);
    expect(config.idleTimeoutMs).toBe(3000);
    expect(config.connectionTimeoutMs).toBe(5000);
    expect(config.queryTimeoutMs).toBe(15000);
  });

  test('should use defaults for all optional env vars', async () => {
    process.env.DB_PASSWORD = 'test';
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_USER;
    delete process.env.DB_NAME;
    delete process.env.DB_POOL_MAX;
    delete process.env.DB_IDLE_TIMEOUT;
    delete process.env.DB_CONNECTION_TIMEOUT;
    delete process.env.DB_QUERY_TIMEOUT;

    const { getDbManager } = await import('../../src/db');
    const config = getDbManager().getConfig();

    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(5432);
    expect(config.user).toBe('postgres');
    expect(config.database).toBe('postgres');
    expect(config.maxConnections).toBe(5);
    expect(config.idleTimeoutMs).toBe(5000);
    expect(config.connectionTimeoutMs).toBe(10000);
    expect(config.queryTimeoutMs).toBe(30000);
  });

  test('getConfig should return a copy, not a reference', async () => {
    process.env.DB_PASSWORD = 'test';

    const { getDbManager } = await import('../../src/db');
    const config1 = getDbManager().getConfig();
    const config2 = getDbManager().getConfig();

    expect(config1).toEqual(config2);
    expect(config1).not.toBe(config2);
  });
});

describe('SSL Configuration Details', () => {
  test('should set rejectUnauthorized true by default when SSL enabled', async () => {
    process.env.DB_PASSWORD = 'test';
    delete process.env.DB_SSL;
    delete process.env.DB_SSL_REJECT_UNAUTHORIZED;
    delete process.env.DB_SSL_CA_CERT;
    delete process.env.DB_SSL_ALLOW_SELF_SIGNED;

    const { getDbManager } = await import('../../src/db');
    const config = getDbManager().getConfig();

    expect(config.ssl).toEqual({ rejectUnauthorized: true });
  });

  test('should set rejectUnauthorized false when DB_SSL_REJECT_UNAUTHORIZED=false', async () => {
    process.env.DB_PASSWORD = 'test';
    process.env.DB_SSL_REJECT_UNAUTHORIZED = 'false';

    const { getDbManager } = await import('../../src/db');
    const config = getDbManager().getConfig();

    expect(typeof config.ssl).toBe('object');
    expect((config.ssl as any).rejectUnauthorized).toBe(false);
  });

  test('should include CA cert when DB_SSL_CA_CERT is set', async () => {
    process.env.DB_PASSWORD = 'test';
    process.env.DB_SSL_CA_CERT = 'my-ca-cert-content';

    const { getDbManager } = await import('../../src/db');
    const config = getDbManager().getConfig();

    expect(typeof config.ssl).toBe('object');
    expect((config.ssl as any).ca).toBe('my-ca-cert-content');
  });

  test('should set rejectUnauthorized false when DB_SSL_ALLOW_SELF_SIGNED=true', async () => {
    process.env.DB_PASSWORD = 'test';
    process.env.DB_SSL_ALLOW_SELF_SIGNED = 'true';

    const { getDbManager } = await import('../../src/db');
    const config = getDbManager().getConfig();

    expect(typeof config.ssl).toBe('object');
    expect((config.ssl as any).rejectUnauthorized).toBe(false);
  });

  test('should return false for ssl when DB_SSL=false', async () => {
    process.env.DB_PASSWORD = 'test';
    process.env.DB_SSL = 'false';

    const { getDbManager } = await import('../../src/db');
    const config = getDbManager().getConfig();

    expect(config.ssl).toBe(false);
  });
});

describe('Connection State', () => {
  test('isConnected should return false before any getDb call', async () => {
    process.env.DB_PASSWORD = 'test';

    const { getDbManager } = await import('../../src/db');
    expect(getDbManager().isConnected()).toBe(false);
  });

  test('isConnected should return true after getDb call', async () => {
    process.env.DB_PASSWORD = 'test';
    process.env.DB_HOST = 'localhost';

    const { getDbManager } = await import('../../src/db');
    getDbManager().getDatabase();
    expect(getDbManager().isConnected()).toBe(true);
  });

  test('isConnected should return false after close', async () => {
    process.env.DB_PASSWORD = 'test';
    process.env.DB_HOST = 'localhost';

    const { getDbManager } = await import('../../src/db');
    getDbManager().getDatabase();
    await getDbManager().close();
    expect(getDbManager().isConnected()).toBe(false);
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `npx jest tests/unit/db.test.ts --verbose`
Expected: All existing tests still pass, new tests pass. The "missing DB_PASSWORD" test may need adjustment depending on how the singleton caches — if it fails, check whether the module cache clearing is sufficient or if `DatabaseManager.instance` needs resetting.

**Important:** The existing test `should handle missing password gracefully` on line 32 currently expects `require('../../src/db')` _not_ to throw when DB_PASSWORD is missing. But looking at `src/db.ts:42`, the constructor _does_ throw. This means either: (a) the existing test passes because DB_PASSWORD is set in the env from a previous test, or (b) the require doesn't call the constructor eagerly. Investigate and reconcile — the new test should confirm the actual behavior.

**Step 3: Commit**

```bash
git add tests/unit/db.test.ts
git commit -m "test: enhance db.ts unit tests for config, SSL, and connection state"
```

---

### Task 2: MCP Protocol Handler Unit Tests

Tests the server's ListTools and CallTool handlers using InMemoryTransport. No database needed — tool implementations are mocked.

**Files:**
- Create: `tests/unit/server/index.test.ts`

**Context:** The MCP server in `src/index.ts` creates a `Server`, registers two handlers (`ListToolsRequestSchema`, `CallToolRequestSchema`), and starts on stdio. We can't import the file directly (it has side effects — it creates the server and calls `main()`). Instead, we test via the SDK's Client+InMemoryTransport by **recreating the server setup in the test** with the same handler logic but mocked tool functions.

However, a cleaner approach: we test the _handlers themselves_ by extracting them. But that would require refactoring `src/index.ts`, which is out of scope. So instead, we create a test server that mirrors the registration from `src/index.ts` but with mocked tools, then connect a real Client to verify the MCP protocol layer works.

**Step 1: Write the test file**

Create `tests/unit/server/index.test.ts`:

```typescript
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  QueryInputSchema,
  DescribeTableInputSchema,
  ListObjectsInputSchema,
  ListSchemasInputSchema,
  ListIndexesInputSchema,
  ExplainQueryInputSchema,
  SearchObjectsInputSchema,
  GetConnectionsInputSchema,
  DiagnoseDatabaseInputSchema,
  GetSlowQueriesInputSchema,
  validateInput,
} from '../../../src/validation';

function getInlineSchema(zodSchema: any, name: string) {
  const jsonSchema = zodToJsonSchema(zodSchema, { name });
  return jsonSchema.definitions?.[name] || jsonSchema;
}

function createSafeToolResponse(result: any) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

function createErrorResponse(error: string, code: string = 'VALIDATION_ERROR') {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          { error, code, timestamp: new Date().toISOString() },
          null,
          2
        ),
      },
    ],
  };
}

const TOOL_NAMES = [
  'query',
  'describe_table',
  'list_objects',
  'list_schemas',
  'list_indexes',
  'explain_query',
  'search_objects',
  'get_connections',
  'diagnose_database',
  'get_slow_queries',
];

const mockToolResults: Record<string, any> = {
  query: { rows: [{ id: 1 }], rowCount: 1 },
  describe_table: { columns: [{ column_name: 'id' }] },
  list_objects: { objects: [{ object_name: 'users' }] },
  list_schemas: { schemas: [{ schema_name: 'public' }] },
  list_indexes: { indexes: [{ index_name: 'pk' }] },
  explain_query: { plan: ['Seq Scan on users'] },
  search_objects: { results: [{ name: 'users' }] },
  get_connections: { summary: { total: 1 } },
  diagnose_database: { status: 'healthy' },
  get_slow_queries: { queries: [], extension_installed: true },
};

const SCHEMAS: Record<string, any> = {
  query: QueryInputSchema,
  describe_table: DescribeTableInputSchema,
  list_objects: ListObjectsInputSchema,
  list_schemas: ListSchemasInputSchema,
  list_indexes: ListIndexesInputSchema,
  explain_query: ExplainQueryInputSchema,
  search_objects: SearchObjectsInputSchema,
  get_connections: GetConnectionsInputSchema,
  diagnose_database: DiagnoseDatabaseInputSchema,
  get_slow_queries: GetSlowQueriesInputSchema,
};

const VALID_INPUTS: Record<string, any> = {
  query: { sql: 'SELECT 1' },
  describe_table: { schema: 'public', table: 'users' },
  list_objects: { type: 'tables' },
  list_schemas: {},
  list_indexes: { schema: 'public' },
  explain_query: { sql: 'SELECT 1' },
  search_objects: { pattern: 'user' },
  get_connections: {},
  diagnose_database: {},
  get_slow_queries: {},
};

function createTestServer() {
  const server = new Server(
    { name: 'postgres-mcp-server', version: '2.0.0' },
    { capabilities: { tools: {} } }
  );

  const SCHEMA_NAMES: Record<string, string> = {
    query: 'QueryInput',
    describe_table: 'DescribeTableInput',
    list_objects: 'ListObjectsInput',
    list_schemas: 'ListSchemasInput',
    list_indexes: 'ListIndexesInput',
    explain_query: 'ExplainQueryInput',
    search_objects: 'SearchObjectsInput',
    get_connections: 'GetConnectionsInput',
    diagnose_database: 'DiagnoseDatabaseInput',
    get_slow_queries: 'GetSlowQueriesInput',
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_NAMES.map((name) => ({
      name,
      description: `Tool: ${name}`,
      inputSchema: getInlineSchema(SCHEMAS[name], SCHEMA_NAMES[name]),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const schema = SCHEMAS[name];
      if (!schema) {
        throw new Error(`Unknown tool: ${name}`);
      }

      const validation = validateInput(schema, args);
      if (!validation.success) {
        return createErrorResponse(`Input validation failed: ${validation.error}`);
      }

      const result = mockToolResults[name];
      return createSafeToolResponse(result);
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Tool execution failed',
              code: 'TOOL_EXECUTION_ERROR',
              timestamp: new Date().toISOString(),
              hint: 'Check your input parameters and try again',
            }, null, 2),
          },
        ],
      };
    }
  });

  return server;
}

describe('MCP Server Protocol Tests', () => {
  let client: InstanceType<typeof Client>;
  let server: InstanceType<typeof Server>;

  beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    server = createTestServer();
    client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  describe('ListTools', () => {
    test('should return all 10 tools', async () => {
      const result = await client.listTools();
      expect(result.tools).toHaveLength(10);
    });

    test('should include correct tool names', async () => {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name).sort();
      expect(names).toEqual([...TOOL_NAMES].sort());
    });

    test('each tool should have a description and inputSchema', async () => {
      const result = await client.listTools();
      for (const tool of result.tools) {
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      }
    });

    test('query tool schema should require sql field', async () => {
      const result = await client.listTools();
      const queryTool = result.tools.find((t) => t.name === 'query');
      expect(queryTool).toBeDefined();
      expect(queryTool!.inputSchema.properties).toHaveProperty('sql');
      expect(queryTool!.inputSchema.required).toContain('sql');
    });

    test('describe_table schema should require schema and table', async () => {
      const result = await client.listTools();
      const tool = result.tools.find((t) => t.name === 'describe_table');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain('schema');
      expect(tool!.inputSchema.required).toContain('table');
    });

    test('list_objects schema should require type enum', async () => {
      const result = await client.listTools();
      const tool = result.tools.find((t) => t.name === 'list_objects');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.properties!.type.enum).toEqual(['tables', 'views', 'functions']);
    });
  });

  describe('CallTool - Routing', () => {
    test.each(TOOL_NAMES)('should route %s tool correctly', async (toolName) => {
      const result = await client.callTool({
        name: toolName,
        arguments: VALID_INPUTS[toolName],
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const parsed = JSON.parse((result.content[0] as any).text);
      expect(parsed).toEqual(mockToolResults[toolName]);
    });
  });

  describe('CallTool - Error Handling', () => {
    test('should return error for unknown tool', async () => {
      const result = await client.callTool({
        name: 'nonexistent_tool',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse((result.content[0] as any).text);
      expect(parsed.code).toBe('TOOL_EXECUTION_ERROR');
    });

    test('should return validation error for missing required field', async () => {
      const result = await client.callTool({
        name: 'query',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse((result.content[0] as any).text);
      expect(parsed.code).toBe('VALIDATION_ERROR');
      expect(parsed.error).toContain('Input validation failed');
    });

    test('should return validation error for invalid schema name format', async () => {
      const result = await client.callTool({
        name: 'describe_table',
        arguments: { schema: '123invalid', table: 'users' },
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse((result.content[0] as any).text);
      expect(parsed.error).toContain('Input validation failed');
    });

    test('should return validation error for invalid enum value', async () => {
      const result = await client.callTool({
        name: 'list_objects',
        arguments: { type: 'invalid_type' },
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse((result.content[0] as any).text);
      expect(parsed.error).toContain('Input validation failed');
    });

    test('should return validation error for out-of-range pageSize', async () => {
      const result = await client.callTool({
        name: 'query',
        arguments: { sql: 'SELECT 1', pageSize: 9999 },
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('Response Format', () => {
    test('successful response should have text content', async () => {
      const result = await client.callTool({
        name: 'query',
        arguments: { sql: 'SELECT 1' },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(() => JSON.parse((result.content[0] as any).text)).not.toThrow();
    });

    test('error response should have isError flag and structured JSON', async () => {
      const result = await client.callTool({
        name: 'query',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse((result.content[0] as any).text);
      expect(parsed).toHaveProperty('error');
      expect(parsed).toHaveProperty('code');
      expect(parsed).toHaveProperty('timestamp');
    });
  });
});
```

**Step 2: Create the directory and run test**

Run: `mkdir -p tests/unit/server && npx jest tests/unit/server/index.test.ts --verbose`
Expected: All tests pass. If InMemoryTransport has import issues with ESM in Jest, you may need to adjust the import path (try `@modelcontextprotocol/sdk/inMemory` without `.js`).

**Step 3: Commit**

```bash
git add tests/unit/server/index.test.ts
git commit -m "test: add MCP protocol handler unit tests with InMemoryTransport"
```

---

### Task 3: E2E MCP Client Integration Test

Full-stack test: real MCP client → server with same handler logic → real database via testcontainer. This proves the entire pipeline works end-to-end.

**Files:**
- Create: `tests/integration/mcp-server.test.ts`

**Context:** Unlike Task 2 (mocked tools), this test uses actual tool implementations connected to a real testcontainer PostgreSQL. The server's CallTool handler calls the real `queryTool`, `describeTableTool`, etc.

**Step 1: Write the test file**

Create `tests/integration/mcp-server.test.ts`:

```typescript
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  setupTestContainer,
  teardownTestContainer,
  isDockerAvailable,
} from '../setup/testcontainer';
import {
  QueryInputSchema,
  DescribeTableInputSchema,
  ListObjectsInputSchema,
  ListSchemasInputSchema,
  ListIndexesInputSchema,
  ExplainQueryInputSchema,
  SearchObjectsInputSchema,
  GetConnectionsInputSchema,
  DiagnoseDatabaseInputSchema,
  GetSlowQueriesInputSchema,
  validateInput,
} from '../../src/validation';

function getInlineSchema(zodSchema: any, name: string) {
  const jsonSchema = zodToJsonSchema(zodSchema, { name });
  return jsonSchema.definitions?.[name] || jsonSchema;
}

const dockerAvailable = isDockerAvailable();
const describeWithDocker = dockerAvailable ? describe : describe.skip;

describeWithDocker('E2E MCP Server Integration Tests', () => {
  let client: InstanceType<typeof Client>;
  let server: InstanceType<typeof Server>;
  let containerSetup: Awaited<ReturnType<typeof setupTestContainer>>;

  beforeAll(async () => {
    containerSetup = await setupTestContainer();

    process.env.DB_HOST = containerSetup.connectionInfo.host;
    process.env.DB_PORT = containerSetup.connectionInfo.port.toString();
    process.env.DB_USER = containerSetup.connectionInfo.username;
    process.env.DB_PASSWORD = containerSetup.connectionInfo.password;
    process.env.DB_NAME = containerSetup.connectionInfo.database;
    process.env.DB_SSL = 'false';
    process.env.READ_ONLY = 'false';
    process.env.NODE_ENV = 'development';

    const modulePaths = [
      '../../src/db',
      '../../src/tools/query',
      '../../src/tools/list',
      '../../src/tools/describe',
      '../../src/tools/schemas',
      '../../src/tools/indexes',
      '../../src/tools/performance',
      '../../src/tools/search',
      '../../src/tools/connections',
      '../../src/tools/diagnostics',
      '../../src/tools/slow-queries',
    ];
    modulePaths.forEach((p) => delete require.cache[require.resolve(p)]);

    const { queryTool } = await import('../../src/tools/query');
    const { describeTableTool } = await import('../../src/tools/describe');
    const { listObjectsTool } = await import('../../src/tools/list');
    const { listSchemasTool } = await import('../../src/tools/schemas');
    const { listIndexesTool } = await import('../../src/tools/indexes');
    const { explainQueryTool } = await import('../../src/tools/performance');
    const { searchObjectsTool } = await import('../../src/tools/search');
    const { getConnectionsTool } = await import('../../src/tools/connections');
    const { diagnoseDatabaseTool } = await import('../../src/tools/diagnostics');
    const { getSlowQueriesTool } = await import('../../src/tools/slow-queries');

    const toolFns: Record<string, Function> = {
      query: queryTool,
      describe_table: describeTableTool,
      list_objects: listObjectsTool,
      list_schemas: listSchemasTool,
      list_indexes: listIndexesTool,
      explain_query: explainQueryTool,
      search_objects: searchObjectsTool,
      get_connections: getConnectionsTool,
      diagnose_database: diagnoseDatabaseTool,
      get_slow_queries: getSlowQueriesTool,
    };

    const SCHEMAS: Record<string, any> = {
      query: QueryInputSchema,
      describe_table: DescribeTableInputSchema,
      list_objects: ListObjectsInputSchema,
      list_schemas: ListSchemasInputSchema,
      list_indexes: ListIndexesInputSchema,
      explain_query: ExplainQueryInputSchema,
      search_objects: SearchObjectsInputSchema,
      get_connections: GetConnectionsInputSchema,
      diagnose_database: DiagnoseDatabaseInputSchema,
      get_slow_queries: GetSlowQueriesInputSchema,
    };

    const SCHEMA_NAMES: Record<string, string> = {
      query: 'QueryInput',
      describe_table: 'DescribeTableInput',
      list_objects: 'ListObjectsInput',
      list_schemas: 'ListSchemasInput',
      list_indexes: 'ListIndexesInput',
      explain_query: 'ExplainQueryInput',
      search_objects: 'SearchObjectsInput',
      get_connections: 'GetConnectionsInput',
      diagnose_database: 'DiagnoseDatabaseInput',
      get_slow_queries: 'GetSlowQueriesInput',
    };

    server = new Server(
      { name: 'postgres-mcp-server', version: '2.0.0' },
      { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Object.keys(toolFns).map((name) => ({
        name,
        description: `Tool: ${name}`,
        inputSchema: getInlineSchema(SCHEMAS[name], SCHEMA_NAMES[name]),
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        const schema = SCHEMAS[name];
        if (!schema) throw new Error(`Unknown tool: ${name}`);

        const validation = validateInput(schema, args);
        if (!validation.success) {
          return {
            isError: true,
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: `Input validation failed: ${validation.error}`, code: 'VALIDATION_ERROR' }, null, 2),
            }],
          };
        }

        const result = await toolFns[name](validation.data);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Tool execution failed', code: 'TOOL_EXECUTION_ERROR' }, null, 2),
          }],
        };
      }
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  }, 120000);

  afterAll(async () => {
    await client.close();
    await server.close();
    const { closeDb } = await import('../../src/db');
    await closeDb();
    await teardownTestContainer();
  }, 30000);

  test('listTools returns all 10 tools', async () => {
    const result = await client.listTools();
    expect(result.tools).toHaveLength(10);
  });

  test('callTool query with real SQL returns rows', async () => {
    const result = await client.callTool({
      name: 'query',
      arguments: { sql: 'SELECT COUNT(*) as count FROM testschema.users' },
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content[0] as any).text);
    expect(parsed.rows).toBeDefined();
    expect(parsed.rows[0].count).toBe('3');
  });

  test('callTool describe_table with real table returns columns', async () => {
    const result = await client.callTool({
      name: 'describe_table',
      arguments: { schema: 'testschema', table: 'users' },
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content[0] as any).text);
    expect(parsed.columns).toBeDefined();
    expect(parsed.columns.length).toBe(6);
  });

  test('callTool list_schemas returns schemas from real database', async () => {
    const result = await client.callTool({
      name: 'list_schemas',
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content[0] as any).text);
    expect(parsed.schemas.map((s: any) => s.schema_name)).toContain('testschema');
  });

  test('callTool with invalid input returns validation error through protocol', async () => {
    const result = await client.callTool({
      name: 'query',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content[0] as any).text);
    expect(parsed.code).toBe('VALIDATION_ERROR');
  });

  test('callTool for unknown tool returns error through protocol', async () => {
    const result = await client.callTool({
      name: 'nonexistent',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content[0] as any).text);
    expect(parsed.code).toBe('TOOL_EXECUTION_ERROR');
  });

  test('callTool diagnose_database returns health status from real database', async () => {
    const result = await client.callTool({
      name: 'diagnose_database',
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content[0] as any).text);
    expect(parsed.status).toBeDefined();
    expect(['healthy', 'warning', 'critical']).toContain(parsed.status);
  });
});
```

**Step 2: Run tests**

Run: `npx jest tests/integration/mcp-server.test.ts --verbose`
Expected: All tests pass (or skip cleanly if Docker unavailable). Should take ~5-10s including container startup.

**Step 3: Commit**

```bash
git add tests/integration/mcp-server.test.ts
git commit -m "test: add E2E MCP client integration test against real database"
```

---

### Task 4: Real Database Connection Tests

Test `getDbManager()` health check, connect/disconnect/reconnect, and `isConnected()` against the real testcontainer. Added to the existing container test file.

**Files:**
- Modify: `tests/integration/container.test.ts`

**Step 1: Add new tests**

Add these tests inside the existing `describeWithDocker("Testcontainer Integration Tests", ...)` block, after the last existing test:

```typescript
test("should verify database health check with real connection", async () => {
  const testTools = createTestTools(containerSetup.connectionInfo);
  try {
    const { closeDb } = await testTools.getTools();
    const { getDbManager } = await import("../../src/db");

    const health = await getDbManager().healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.error).toBeUndefined();

    await closeDb();
  } finally {
    testTools.cleanup();
  }
});

test("should reconnect after close with real database", async () => {
  const testTools = createTestTools(containerSetup.connectionInfo);
  try {
    const { queryTool, closeDb } = await testTools.getTools();
    const { getDbManager } = await import("../../src/db");

    const result1 = await queryTool({ sql: 'SELECT 1 as val' });
    expect(result1.error).toBeUndefined();
    expect(getDbManager().isConnected()).toBe(true);

    await closeDb();
    expect(getDbManager().isConnected()).toBe(false);

    const result2 = await queryTool({ sql: 'SELECT 2 as val' });
    expect(result2.error).toBeUndefined();
    expect(getDbManager().isConnected()).toBe(true);

    await closeDb();
  } finally {
    testTools.cleanup();
  }
});

test("should return correct config for container connection", async () => {
  const testTools = createTestTools(containerSetup.connectionInfo);
  try {
    await testTools.getTools();
    const { getDbManager } = await import("../../src/db");

    const config = getDbManager().getConfig();
    expect(config.host).toBe(containerSetup.connectionInfo.host);
    expect(config.port).toBe(containerSetup.connectionInfo.port);
    expect(config.user).toBe(containerSetup.connectionInfo.username);
    expect(config.database).toBe(containerSetup.connectionInfo.database);
    expect(config.ssl).toBe(false);

    const { closeDb } = await import("../../src/db");
    await closeDb();
  } finally {
    testTools.cleanup();
  }
});
```

**Step 2: Run tests**

Run: `npx jest tests/integration/container.test.ts --verbose`
Expected: All 19 tests pass (16 existing + 3 new).

**Step 3: Run full suite**

Run: `npx jest --verbose`
Expected: All tests pass. Total count should be ~360+ (336 existing + new tests from all 4 tasks).

**Step 4: Commit**

```bash
git add tests/integration/container.test.ts
git commit -m "test: add real database connection tests for health check and reconnection"
```

---

### Task 5: Final Verification

**Step 1: Run full test suite with coverage**

Run: `npx jest --coverage`
Expected: All tests pass. Coverage for `src/index.ts` won't increase (we tested a mirror of its logic, not the file itself). Coverage for `src/db.ts` should increase significantly.

**Step 2: Verify test counts**

Run: `npx jest --verbose 2>&1 | tail -5`
Expected output should show increased test count and all suites passing.

**Step 3: Commit any final adjustments**

If any test needed minor fixes during tasks 1-4, ensure all fixes are committed.
