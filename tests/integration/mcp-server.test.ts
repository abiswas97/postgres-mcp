import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  setupTestContainer,
  teardownTestContainer,
  isDockerAvailable,
} from "../setup/testcontainer";
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
} from "../../src/validation";

function getInlineSchema(zodSchema: any, name: string) {
  const jsonSchema = zodToJsonSchema(zodSchema, { name });
  return (jsonSchema as any).definitions?.[name] || jsonSchema;
}

const dockerAvailable = isDockerAvailable();
const describeWithDocker = dockerAvailable ? describe : describe.skip;

describeWithDocker("E2E MCP Client Integration Tests", () => {
  let client: Client;
  let server: Server;
  let containerSetup: Awaited<ReturnType<typeof setupTestContainer>>;
  let closeDb: () => Promise<void>;

  beforeAll(async () => {
    containerSetup = await setupTestContainer();

    const originalEnv = { ...process.env };
    process.env.DB_HOST = containerSetup.connectionInfo.host;
    process.env.DB_PORT = containerSetup.connectionInfo.port.toString();
    process.env.DB_USER = containerSetup.connectionInfo.username;
    process.env.DB_PASSWORD = containerSetup.connectionInfo.password;
    process.env.DB_NAME = containerSetup.connectionInfo.database;
    process.env.DB_SSL = "false";
    process.env.READ_ONLY = "false";
    process.env.NODE_ENV = "development";

    const modulePaths = [
      "../../src/db",
      "../../src/tools/query",
      "../../src/tools/list",
      "../../src/tools/describe",
      "../../src/tools/schemas",
      "../../src/tools/indexes",
      "../../src/tools/performance",
      "../../src/tools/search",
      "../../src/tools/connections",
      "../../src/tools/diagnostics",
      "../../src/tools/slow-queries",
    ];
    modulePaths.forEach((p) => delete require.cache[require.resolve(p)]);

    const { queryTool } = await import("../../src/tools/query");
    const { listObjectsTool } = await import("../../src/tools/list");
    const { describeTableTool } = await import("../../src/tools/describe");
    const { listSchemasTool } = await import("../../src/tools/schemas");
    const { listIndexesTool } = await import("../../src/tools/indexes");
    const { explainQueryTool } = await import("../../src/tools/performance");
    const { searchObjectsTool } = await import("../../src/tools/search");
    const { getConnectionsTool } = await import("../../src/tools/connections");
    const { diagnoseDatabaseTool } = await import("../../src/tools/diagnostics");
    const { getSlowQueriesTool } = await import("../../src/tools/slow-queries");
    const dbModule = await import("../../src/db");
    closeDb = dbModule.closeDb;

    const toolMap: Record<string, (args: any) => Promise<any>> = {
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

    const schemaMap: Record<string, { zodSchema: any; name: string; description: string }> = {
      query: { zodSchema: QueryInputSchema, name: "QueryInput", description: "Execute SQL with pagination and parameterization" },
      describe_table: { zodSchema: DescribeTableInputSchema, name: "DescribeTableInput", description: "Get table structure including columns, constraints, and size statistics" },
      list_objects: { zodSchema: ListObjectsInputSchema, name: "ListObjectsInput", description: "List tables, views, or functions in a schema" },
      list_schemas: { zodSchema: ListSchemasInputSchema, name: "ListSchemasInput", description: "List all schemas in the database" },
      list_indexes: { zodSchema: ListIndexesInputSchema, name: "ListIndexesInput", description: "List indexes for a table or schema" },
      explain_query: { zodSchema: ExplainQueryInputSchema, name: "ExplainQueryInput", description: "Get query execution plan (EXPLAIN)" },
      search_objects: { zodSchema: SearchObjectsInputSchema, name: "SearchObjectsInput", description: "Find tables, columns, functions, views by name pattern across schemas" },
      get_connections: { zodSchema: GetConnectionsInputSchema, name: "GetConnectionsInput", description: "Show active database connections" },
      diagnose_database: { zodSchema: DiagnoseDatabaseInputSchema, name: "DiagnoseDatabaseInput", description: "Composite database health check" },
      get_slow_queries: { zodSchema: GetSlowQueriesInputSchema, name: "GetSlowQueriesInput", description: "Analyze slow queries via pg_stat_statements" },
    };

    server = new Server(
      { name: "postgres-mcp-server-test", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: Object.entries(schemaMap).map(([toolName, { zodSchema, name, description }]) => ({
          name: toolName,
          description,
          inputSchema: getInlineSchema(zodSchema, name),
        })),
      };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const schemaDef = schemaMap[name];
        if (!schemaDef) {
          throw new Error(`Unknown tool: ${name}`);
        }

        const validation = validateInput(schemaDef.zodSchema, args);
        if (!validation.success) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: `Input validation failed: ${validation.error}`,
                  code: "VALIDATION_ERROR",
                  timestamp: new Date().toISOString(),
                }),
              },
            ],
          };
        }

        const toolFn = toolMap[name];
        const result = await toolFn(validation.data);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: errorMessage,
                code: "TOOL_EXECUTION_ERROR",
                timestamp: new Date().toISOString(),
              }),
            },
          ],
        };
      }
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);

    client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} }
    );
    await client.connect(clientTransport);
  }, 120000);

  afterAll(async () => {
    try { await client?.close(); } catch {}
    try { await server?.close(); } catch {}
    try { await closeDb?.(); } catch {}
    await teardownTestContainer();
  }, 30000);

  test("listTools returns all 10 tools", async () => {
    const result = await client.listTools();
    expect(result.tools).toHaveLength(10);

    const toolNames = result.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual([
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

  test("callTool query with real SQL returns rows", async () => {
    const result = await client.callTool({
      name: "query",
      arguments: { sql: "SELECT COUNT(*) as count FROM testschema.users" },
    }) as any;

    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);

    const content = result.content[0];
    expect(content).toHaveProperty("text");
    const parsed = JSON.parse(content.text);
    expect(parsed.rows[0].count).toBe("3");
  });

  test("callTool describe_table with real table returns columns", async () => {
    const result = await client.callTool({
      name: "describe_table",
      arguments: { schema: "testschema", table: "users" },
    }) as any;

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.columns).toHaveLength(6);
  });

  test("callTool list_schemas returns schemas from real database", async () => {
    const result = await client.callTool({
      name: "list_schemas",
      arguments: {},
    }) as any;

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    const schemaNames = parsed.schemas.map((s: any) => s.schema_name);
    expect(schemaNames).toContain("testschema");
  });

  test("callTool with invalid input returns validation error through protocol", async () => {
    const result = await client.callTool({
      name: "query",
      arguments: {},
    }) as any;

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("VALIDATION_ERROR");
  });

  test("callTool for unknown tool returns error through protocol", async () => {
    const result = await client.callTool({
      name: "nonexistent_tool",
      arguments: {},
    }) as any;

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("TOOL_EXECUTION_ERROR");
  });

  test("callTool diagnose_database returns health status from real database", async () => {
    const result = await client.callTool({
      name: "diagnose_database",
      arguments: {},
    }) as any;

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(["healthy", "warning", "critical"]).toContain(parsed.status);
  });
});
