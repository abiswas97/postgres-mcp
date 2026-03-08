# MCP Server Test Hardening Design

**Goal:** Fill critical test gaps in the MCP protocol layer and db.ts connection handling before publishing.

**Architecture:** Four components — handler unit tests, e2e MCP client test, enhanced db.ts unit tests, and real db connection tests in the container suite.

**Tech Stack:** Jest, @modelcontextprotocol/sdk (Client + InMemoryTransport), testcontainers

---

## Component 1: MCP Protocol Handler Unit Tests

**File:** `tests/unit/server/index.test.ts`

Tests the MCP server routing/formatting layer with mocked tool implementations.

- ListToolsRequest: all 10 tools registered with correct names, descriptions, valid JSON schemas
- CallToolRequest dispatcher: each tool name routes correctly
- Unknown tool → error response
- Validation error flow (bad input → createErrorResponse)
- createSafeToolResponse / createErrorResponse formatting
- getInlineSchema produces valid schemas from Zod

Uses InMemoryTransport from SDK to create an in-process client-server pair. Tool functions are mocked so no database needed.

## Component 2: E2E MCP Client Test

**File:** `tests/integration/mcp-server.test.ts`

Full-stack test: real MCP client → real server → real database (testcontainer).

- Connect MCP client via InMemoryTransport to server
- listTools returns all 10 tools
- callTool for query tool with real SQL
- callTool for describe_table with real table
- callTool with invalid input → proper error through protocol
- callTool for unknown tool → error

Reuses testcontainer setup from existing integration tests.

## Component 3: Enhanced db.ts Unit Tests

**File:** `tests/unit/db.test.ts` (enhance existing)

- Missing DB_PASSWORD throws error
- Non-numeric DB_PORT falls back to NaN (or default)
- SSL config combinations: DB_SSL=false, DB_SSL=true, DB_SSL_CA_CERT set, DB_SSL_ALLOW_SELF_SIGNED=true
- getConfig() returns copy (not reference)
- isConnected() returns correct state
- Pool config passes correct values (max, idle timeout, query timeout)

## Component 4: Real Connection Tests

**File:** `tests/integration/container.test.ts` (add to existing)

- getDbManager().healthCheck() returns healthy:true
- closeDb() then getDb() reconnects successfully
- isConnected() reflects actual state
- getConfig() returns correct container connection info

No extra container needed — piggybacks on existing setup.
