#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { zodToJsonSchema } from "zod-to-json-schema";
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
  validateInput
} from "./validation.js";
import { queryTool } from "./tools/query.js";
import { describeTableTool } from "./tools/describe.js";
import { listObjectsTool } from "./tools/list.js";
import { listSchemasTool } from "./tools/schemas.js";
import { listIndexesTool } from "./tools/indexes.js";
import { explainQueryTool } from "./tools/performance.js";
import { searchObjectsTool } from "./tools/search.js";
import { getConnectionsTool } from "./tools/connections.js";
import { diagnoseDatabaseTool } from "./tools/diagnostics.js";
import { closeDb } from "./db.js";

// Helper to extract inline schema from zodToJsonSchema output
function getInlineSchema(zodSchema: any, name: string) {
  const jsonSchema = zodToJsonSchema(zodSchema, { name });
  return jsonSchema.definitions?.[name] || jsonSchema;
}

const server = new Server(
  {
    name: "postgres-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "query",
        description: "Execute SQL with pagination and parameterization",
        inputSchema: getInlineSchema(QueryInputSchema, "QueryInput"),
      },
      {
        name: "describe_table",
        description: "Get table structure including columns, constraints, and size statistics",
        inputSchema: getInlineSchema(DescribeTableInputSchema, "DescribeTableInput"),
      },
      {
        name: "list_objects",
        description: "List tables, views, or functions in a schema",
        inputSchema: getInlineSchema(ListObjectsInputSchema, "ListObjectsInput"),
      },
      {
        name: "list_schemas",
        description: "List all schemas in the database",
        inputSchema: getInlineSchema(ListSchemasInputSchema, "ListSchemasInput"),
      },
      {
        name: "list_indexes",
        description: "List indexes for a table or schema",
        inputSchema: getInlineSchema(ListIndexesInputSchema, "ListIndexesInput"),
      },
      {
        name: "explain_query",
        description: "Get query execution plan (EXPLAIN)",
        inputSchema: getInlineSchema(ExplainQueryInputSchema, "ExplainQueryInput"),
      },
      {
        name: "search_objects",
        description: "Find tables, columns, functions, views by name pattern across schemas",
        inputSchema: getInlineSchema(SearchObjectsInputSchema, "SearchObjectsInput"),
      },
      {
        name: "get_connections",
        description: "Show active database connections, utilization, and idle-in-transaction warnings",
        inputSchema: getInlineSchema(GetConnectionsInputSchema, "GetConnectionsInput"),
      },
      {
        name: "diagnose_database",
        description: "Composite database health check: cache, connections, vacuum, indexes, sequences",
        inputSchema: getInlineSchema(DiagnoseDatabaseInputSchema, "DiagnoseDatabaseInput"),
      },
    ],
  };
});

// Helper function to safely validate and execute tools
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
            timestamp: new Date().toISOString()
          },
          null,
          2
        ),
      },
    ],
  };
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "query": {
        const validation = validateInput(QueryInputSchema, args);
        if (!validation.success) {
          return createErrorResponse(`Input validation failed: ${validation.error}`);
        }
        const result = await queryTool(validation.data);
        return createSafeToolResponse(result);
      }

      case "describe_table": {
        const validation = validateInput(DescribeTableInputSchema, args);
        if (!validation.success) {
          return createErrorResponse(`Input validation failed: ${validation.error}`);
        }
        const result = await describeTableTool(validation.data);
        return createSafeToolResponse(result);
      }

      case "list_objects": {
        const validation = validateInput(ListObjectsInputSchema, args);
        if (!validation.success) {
          return createErrorResponse(`Input validation failed: ${validation.error}`);
        }
        const result = await listObjectsTool(validation.data);
        return createSafeToolResponse(result);
      }

      case "list_schemas": {
        const validation = validateInput(ListSchemasInputSchema, args);
        if (!validation.success) {
          return createErrorResponse(`Input validation failed: ${validation.error}`);
        }
        const result = await listSchemasTool(validation.data);
        return createSafeToolResponse(result);
      }

      case "list_indexes": {
        const validation = validateInput(ListIndexesInputSchema, args);
        if (!validation.success) {
          return createErrorResponse(`Input validation failed: ${validation.error}`);
        }
        const result = await listIndexesTool(validation.data);
        return createSafeToolResponse(result);
      }

      case "explain_query": {
        const validation = validateInput(ExplainQueryInputSchema, args);
        if (!validation.success) {
          return createErrorResponse(`Input validation failed: ${validation.error}`);
        }
        const result = await explainQueryTool(validation.data);
        return createSafeToolResponse(result);
      }

      case "search_objects": {
        const validation = validateInput(SearchObjectsInputSchema, args);
        if (!validation.success) {
          return createErrorResponse(`Input validation failed: ${validation.error}`);
        }
        const result = await searchObjectsTool(validation.data);
        return createSafeToolResponse(result);
      }

      case "get_connections": {
        const validation = validateInput(GetConnectionsInputSchema, args);
        if (!validation.success) {
          return createErrorResponse(`Input validation failed: ${validation.error}`);
        }
        const result = await getConnectionsTool(validation.data);
        return createSafeToolResponse(result);
      }

      case "diagnose_database": {
        const validation = validateInput(DiagnoseDatabaseInputSchema, args);
        if (!validation.success) {
          return createErrorResponse(`Input validation failed: ${validation.error}`);
        }
        const result = await diagnoseDatabaseTool(validation.data);
        return createSafeToolResponse(result);
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: "Tool execution failed",
              code: "TOOL_EXECUTION_ERROR",
              timestamp: new Date().toISOString(),
              hint: "Check your input parameters and try again"
            },
            null,
            2
          ),
        },
      ],
    };
  }
});

async function shutdown() {
  await closeDb();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
