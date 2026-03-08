import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  DescribeTableInputSchema,
  DiagnoseDatabaseInputSchema,
  ExplainQueryInputSchema,
  GetConnectionsInputSchema,
  GetSlowQueriesInputSchema,
  ListIndexesInputSchema,
  ListObjectsInputSchema,
  ListSchemasInputSchema,
  QueryInputSchema,
  SearchObjectsInputSchema,
  validateInput,
} from "../../../src/validation";

function getInlineSchema(zodSchema: any, name: string) {
  const jsonSchema = zodToJsonSchema(zodSchema, { name });
  return (jsonSchema as any).definitions?.[name] || jsonSchema;
}

const MOCK_RESULTS: Record<string, any> = {
  query: { rows: [{ id: 1 }], rowCount: 1 },
  describe_table: { columns: [{ column_name: "id" }] },
  list_objects: { objects: [{ object_name: "users" }] },
  list_schemas: { schemas: [{ schema_name: "public" }] },
  list_indexes: { indexes: [{ index_name: "pk" }] },
  explain_query: { plan: ["Seq Scan on users"] },
  search_objects: { results: [{ name: "users" }] },
  get_connections: { summary: { total: 1 } },
  diagnose_database: { status: "healthy" },
  get_slow_queries: { queries: [], extension_installed: true },
};

const TOOL_SCHEMAS: Record<string, { schema: any; name: string }> = {
  query: { schema: QueryInputSchema, name: "QueryInput" },
  describe_table: { schema: DescribeTableInputSchema, name: "DescribeTableInput" },
  list_objects: { schema: ListObjectsInputSchema, name: "ListObjectsInput" },
  list_schemas: { schema: ListSchemasInputSchema, name: "ListSchemasInput" },
  list_indexes: { schema: ListIndexesInputSchema, name: "ListIndexesInput" },
  explain_query: { schema: ExplainQueryInputSchema, name: "ExplainQueryInput" },
  search_objects: { schema: SearchObjectsInputSchema, name: "SearchObjectsInput" },
  get_connections: { schema: GetConnectionsInputSchema, name: "GetConnectionsInput" },
  diagnose_database: { schema: DiagnoseDatabaseInputSchema, name: "DiagnoseDatabaseInput" },
  get_slow_queries: { schema: GetSlowQueriesInputSchema, name: "GetSlowQueriesInput" },
};

function createSafeToolResponse(result: any) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

function createErrorResponse(error: string, code: string = "VALIDATION_ERROR") {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            error,
            code,
            timestamp: new Date().toISOString(),
          },
          null,
          2,
        ),
      },
    ],
  };
}

const TOOL_DEFINITIONS = [
  {
    name: "query",
    description: "Execute SQL with pagination and parameterization",
    schemaKey: "query",
  },
  {
    name: "describe_table",
    description: "Get table structure including columns, constraints, and size statistics",
    schemaKey: "describe_table",
  },
  {
    name: "list_objects",
    description: "List tables, views, or functions in a schema",
    schemaKey: "list_objects",
  },
  {
    name: "list_schemas",
    description: "List all schemas in the database",
    schemaKey: "list_schemas",
  },
  {
    name: "list_indexes",
    description: "List indexes for a table or schema",
    schemaKey: "list_indexes",
  },
  {
    name: "explain_query",
    description: "Get query execution plan (EXPLAIN)",
    schemaKey: "explain_query",
  },
  {
    name: "search_objects",
    description: "Find tables, columns, functions, views by name pattern across schemas",
    schemaKey: "search_objects",
  },
  {
    name: "get_connections",
    description: "Show active database connections, utilization, and idle-in-transaction warnings",
    schemaKey: "get_connections",
  },
  {
    name: "diagnose_database",
    description: "Composite database health check: cache, connections, vacuum, indexes, sequences",
    schemaKey: "diagnose_database",
  },
  {
    name: "get_slow_queries",
    description: "Analyze slow queries via pg_stat_statements with filtering and sorting",
    schemaKey: "get_slow_queries",
  },
];

function setupTestServer(): Server {
  const server = new Server(
    { name: "postgres-mcp-server-test", version: "2.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: TOOL_DEFINITIONS.map((def) => ({
        name: def.name,
        description: def.description,
        inputSchema: getInlineSchema(
          TOOL_SCHEMAS[def.schemaKey].schema,
          TOOL_SCHEMAS[def.schemaKey].name,
        ),
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const toolSchema = TOOL_SCHEMAS[name];
      if (!toolSchema) {
        throw new Error(`Unknown tool: ${name}`);
      }

      const validation = validateInput(toolSchema.schema, args);
      if (!validation.success) {
        return createErrorResponse(`Input validation failed: ${validation.error}`);
      }

      return createSafeToolResponse(MOCK_RESULTS[name]);
    } catch (_error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                error: "Tool execution failed",
                code: "TOOL_EXECUTION_ERROR",
                timestamp: new Date().toISOString(),
                hint: "Check your input parameters and try again",
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  });

  return server;
}

describe("MCP Protocol Handler", () => {
  let server: Server;
  let client: Client;

  beforeAll(async () => {
    server = setupTestServer();
    client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  describe("ListTools", () => {
    test("returns all 10 tools", async () => {
      const result = await client.listTools();
      expect(result.tools).toHaveLength(10);
    });

    test("all tool names are correct", async () => {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "describe_table",
        "diagnose_database",
        "explain_query",
        "get_connections",
        "get_slow_queries",
        "list_indexes",
        "list_objects",
        "list_schemas",
        "query",
        "search_objects",
      ]);
    });

    test('each tool has description and inputSchema with type "object"', async () => {
      const result = await client.listTools();
      for (const tool of result.tools) {
        expect(tool.description).toBeTruthy();
        expect(typeof tool.description).toBe("string");
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
      }
    });

    test("query tool schema requires sql field", async () => {
      const result = await client.listTools();
      const queryTool = result.tools.find((t) => t.name === "query");
      expect(queryTool).toBeDefined();
      const schema = queryTool!.inputSchema as any;
      expect(schema.required).toContain("sql");
      expect(schema.properties.sql).toBeDefined();
    });

    test("describe_table schema requires schema and table", async () => {
      const result = await client.listTools();
      const tool = result.tools.find((t) => t.name === "describe_table");
      expect(tool).toBeDefined();
      const schema = tool!.inputSchema as any;
      expect(schema.required).toContain("schema");
      expect(schema.required).toContain("table");
    });

    test("list_objects schema has type enum with tables, views, functions", async () => {
      const result = await client.listTools();
      const tool = result.tools.find((t) => t.name === "list_objects");
      expect(tool).toBeDefined();
      const schema = tool!.inputSchema as any;
      expect(schema.properties.type.enum).toEqual(["tables", "views", "functions"]);
    });
  });

  describe("CallTool routing", () => {
    const toolInputs: Array<[string, Record<string, any>]> = [
      ["query", { sql: "SELECT 1" }],
      ["describe_table", { schema: "public", table: "users" }],
      ["list_objects", { type: "tables" }],
      ["list_schemas", {}],
      ["list_indexes", { schema: "public" }],
      ["explain_query", { sql: "SELECT 1" }],
      ["search_objects", { pattern: "user" }],
      ["get_connections", {}],
      ["diagnose_database", {}],
      ["get_slow_queries", {}],
    ];

    test.each(toolInputs)("%s routes correctly and returns mock result", async (toolName, args) => {
      const result = await client.callTool({ name: toolName, arguments: args });
      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
      const content = (result.content as any[])[0] as { type: string; text: string };
      expect(content.type).toBe("text");
      const parsed = JSON.parse(content.text);
      expect(parsed).toEqual(MOCK_RESULTS[toolName]);
    });
  });

  describe("CallTool errors", () => {
    test("unknown tool name returns TOOL_EXECUTION_ERROR", async () => {
      const result = await client.callTool({ name: "nonexistent_tool", arguments: {} });
      expect(result.isError).toBe(true);
      const content = (result.content as any[])[0] as { type: string; text: string };
      const parsed = JSON.parse(content.text);
      expect(parsed.code).toBe("TOOL_EXECUTION_ERROR");
    });

    test("missing required field returns VALIDATION_ERROR", async () => {
      const result = await client.callTool({ name: "query", arguments: {} });
      expect(result.isError).toBe(true);
      const content = (result.content as any[])[0] as { type: string; text: string };
      const parsed = JSON.parse(content.text);
      expect(parsed.code).toBe("VALIDATION_ERROR");
      expect(parsed.error).toContain("Input validation failed");
    });

    test("invalid schema name format returns validation error", async () => {
      const result = await client.callTool({
        name: "describe_table",
        arguments: { schema: "123invalid", table: "users" },
      });
      expect(result.isError).toBe(true);
      const content = (result.content as any[])[0] as { type: string; text: string };
      const parsed = JSON.parse(content.text);
      expect(parsed.code).toBe("VALIDATION_ERROR");
      expect(parsed.error).toContain("Input validation failed");
    });

    test("invalid enum value returns validation error", async () => {
      const result = await client.callTool({
        name: "list_objects",
        arguments: { type: "invalid_type" },
      });
      expect(result.isError).toBe(true);
      const content = (result.content as any[])[0] as { type: string; text: string };
      const parsed = JSON.parse(content.text);
      expect(parsed.code).toBe("VALIDATION_ERROR");
      expect(parsed.error).toContain("Input validation failed");
    });

    test("out-of-range pageSize returns validation error", async () => {
      const result = await client.callTool({
        name: "query",
        arguments: { sql: "SELECT 1", pageSize: 9999 },
      });
      expect(result.isError).toBe(true);
      const content = (result.content as any[])[0] as { type: string; text: string };
      const parsed = JSON.parse(content.text);
      expect(parsed.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("Response format", () => {
    test("successful response has content[0].type=text and parseable JSON", async () => {
      const result = await client.callTool({ name: "query", arguments: { sql: "SELECT 1" } });
      expect(result.isError).toBeFalsy();
      const contentArr = result.content as any[];
      expect(contentArr).toHaveLength(1);
      const content = contentArr[0] as { type: string; text: string };
      expect(content.type).toBe("text");
      expect(() => JSON.parse(content.text)).not.toThrow();
    });

    test("error response has isError:true and structured JSON with error, code, timestamp", async () => {
      const result = await client.callTool({ name: "query", arguments: {} });
      expect(result.isError).toBe(true);
      const content = (result.content as any[])[0] as { type: string; text: string };
      const parsed = JSON.parse(content.text);
      expect(parsed).toHaveProperty("error");
      expect(parsed).toHaveProperty("code");
      expect(parsed).toHaveProperty("timestamp");
    });
  });
});
